import * as Encoding from "effect/Encoding";
import * as Effect from "effect/Effect";
import * as Micro from "effect/Micro";

import { UploadThingError, parseTimeToSeconds } from "@uploadthing/shared";
import type { Time } from "@uploadthing/shared";

/**
 * Generate AWS S3 SigV4 presigned URLs for PUT operations
 * Supports both AWS S3 and S3-compatible endpoints (MinIO, Cloudflare R2, etc)
 */

const encoder = new TextEncoder();

function hexToUint8Array(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

async function hmacSha256(
  key: string | Uint8Array,
  data: string,
): Promise<Uint8Array> {
  const keyBuffer = typeof key === "string" ? encoder.encode(key) : key;
  const keyObj = await crypto.subtle.importKey(
    "raw",
    keyBuffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", keyObj, encoder.encode(data));
  return new Uint8Array(signature);
}

function uint8ArrayToHex(arr: Uint8Array): string {
  return Array.from(arr)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function hashSha256(data: string): Promise<string> {
  const buf = encoder.encode(data);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return uint8ArrayToHex(new Uint8Array(hash));
}

export interface S3PresignConfig {
  endpoint: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
  region: string;
  key: string;
  ttl?: Time | undefined;
}

export const generateS3PresignedUrl = (config: S3PresignConfig) =>
  Micro.gen(function* () {
    const {
      endpoint,
      bucket,
      accessKey,
      secretKey,
      region,
      key,
      ttl,
    } = config;

    const ttlInSeconds = ttl ? parseTimeToSeconds(ttl) : 3600;

    const url = new URL(`${endpoint}/${bucket}/${key}`);
    const now = new Date();
    const timestamp = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
    const dateStr = timestamp.slice(0, 8);

    // Step 1: Create canonical request
    const method = "PUT";
    const canonicalUri = `/${bucket}/${key}`;
    const canonicalQuerystring = `X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=${encodeURIComponent(
      `${accessKey}/${dateStr}/${region}/s3/aws4_request`,
    )}&X-Amz-Date=${timestamp}&X-Amz-Expires=${ttlInSeconds}&X-Amz-SignedHeaders=host`;

    // Canonical headers (only host is required for presigned URLs)
    const host = new URL(endpoint).hostname;
    const canonicalHeaders = `host:${host}\n`;
    const signedHeaders = "host";

    // For presigned URLs, use UNSIGNED-PAYLOAD (R2 requirement)
    const payloadHash = "UNSIGNED-PAYLOAD";

    const canonicalRequest = `${method}\n${canonicalUri}\n${canonicalQuerystring}\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;

    // Step 2: Create string to sign
    const canonicalRequestHash = yield* Micro.tryPromise({
      try: () => hashSha256(canonicalRequest),
      catch: (e) =>
        new UploadThingError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to hash canonical request",
          cause: e,
        }),
    });

    const stringToSign = `AWS4-HMAC-SHA256\n${timestamp}\n${dateStr}/${region}/s3/aws4_request\n${canonicalRequestHash}`;

    // Step 3: Calculate signature
    const kDate = yield* Micro.tryPromise({
      try: () => hmacSha256(`AWS4${secretKey}`, dateStr),
      catch: (e) =>
        new UploadThingError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to generate kDate",
          cause: e,
        }),
    });

    const kRegion = yield* Micro.tryPromise({
      try: async () => {
        return await hmacSha256(kDate, region);
      },
      catch: (e) =>
        new UploadThingError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to generate kRegion",
          cause: e,
        }),
    });

    const kService = yield* Micro.tryPromise({
      try: async () => {
        return await hmacSha256(kRegion, "s3");
      },
      catch: (e) =>
        new UploadThingError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to generate kService",
          cause: e,
        }),
    });

    const kSigning = yield* Micro.tryPromise({
      try: async () => {
        return await hmacSha256(kService, "aws4_request");
      },
      catch: (e) =>
        new UploadThingError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to generate kSigning",
          cause: e,
        }),
    });

    const signature = yield* Micro.tryPromise({
      try: async () => {
        const sig = await hmacSha256(kSigning, stringToSign);
        return uint8ArrayToHex(sig);
      },
      catch: (e) =>
        new UploadThingError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to generate signature",
          cause: e,
        }),
    });

    // Step 4: Build presigned URL
    const presignedUrl = `${endpoint}/${bucket}/${key}?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=${encodeURIComponent(
      `${accessKey}/${dateStr}/${region}/s3/aws4_request`,
    )}&X-Amz-Date=${timestamp}&X-Amz-Expires=${ttlInSeconds}&X-Amz-SignedHeaders=host&X-Amz-Signature=${signature}`;

    return presignedUrl;
  }).pipe(Effect.scoped);
