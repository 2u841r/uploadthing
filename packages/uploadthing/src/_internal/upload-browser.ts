import { unsafeCoerce } from "effect/Function";
import * as Micro from "effect/Micro";
import { hasProperty, isRecord } from "effect/Predicate";

import type { FetchContext, FetchError } from "@uploadthing/shared";
import { fetchEff, UploadThingError } from "@uploadthing/shared";

import { version } from "../../package.json";
import type {
  ClientUploadedFileData,
  FileRouter,
  inferEndpointOutput,
  NewPresignedUrl,
  UploadFilesOptions,
} from "../types";
import { logDeprecationWarning } from "./deprecations";
import type { TraceHeaders } from "./random-hex";
import { generateTraceHeaders } from "./random-hex";
import type { UploadPutResult } from "./types";
import { createUTReporter } from "./ut-reporter";

const uploadWithProgress = (
  file: File,
  rangeStart: number,
  presigned: NewPresignedUrl,
  opts: {
    traceHeaders: TraceHeaders;
    onUploadProgress?:
      | ((opts: { loaded: number; delta: number }) => void)
      | undefined;
  },
) =>
  Micro.async<unknown, UploadThingError, FetchContext>((resume) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", presigned.url, true);

    // Check if this is an S3 presigned URL (contains AWS signature params)
    const isS3Upload = presigned.url.includes("X-Amz-Signature");

    if (!isS3Upload) {
      // For UploadThing: add tracing headers (signature doesn't validate them)
      xhr.setRequestHeader("x-uploadthing-version", version);
      xhr.setRequestHeader("b3", opts.traceHeaders.b3);
      xhr.setRequestHeader("traceparent", opts.traceHeaders.traceparent);
      // UploadThing supports Range header for resumable uploads
      xhr.setRequestHeader("Range", `bytes=${rangeStart}-`);
      xhr.responseType = "json";
    }
    // For S3: DON'T set extra headers - they weren't part of the signature

    let previousLoaded = 0;
    xhr.upload.addEventListener("progress", ({ loaded }) => {
      const delta = loaded - previousLoaded;
      opts.onUploadProgress?.({ loaded, delta });
      previousLoaded = loaded;
    });
    xhr.addEventListener("load", () => {
      console.log(
        `[uploadWithProgress] XHR load: status=${xhr.status}, isS3=${isS3Upload}`,
        xhr.response,
      );

      if (xhr.status >= 200 && xhr.status < 300) {
        if (isS3Upload) {
          // S3 returns 200 with no response body for successful PUT
          console.log("[uploadWithProgress] S3 upload successful");
          resume(
            Micro.succeed({
              serverData: null,
              url: null,
              appUrl: null,
              ufsUrl: null,
              fileHash: null,
            }),
          );
        } else if (isRecord(xhr.response)) {
          if (hasProperty(xhr.response, "error")) {
            resume(
              new UploadThingError({
                code: "UPLOAD_FAILED",
                message: String(xhr.response.error),
                data: xhr.response as never,
              }),
            );
          } else {
            resume(Micro.succeed(xhr.response));
          }
        } else {
          resume(
            new UploadThingError({
              code: "UPLOAD_FAILED",
              message: `XHR failed ${xhr.status} ${xhr.statusText}`,
            }),
          );
        }
      } else {
        console.error(
          `[uploadWithProgress] Upload failed: ${xhr.status} ${xhr.statusText}`,
          xhr.response,
        );
        resume(
          new UploadThingError({
            code: "UPLOAD_FAILED",
            message: `XHR failed ${xhr.status} ${xhr.statusText}`,
            data: xhr.response as never,
          }),
        );
      }
    });

    xhr.addEventListener("error", () => {
      resume(
        new UploadThingError({
          code: "UPLOAD_FAILED",
        }),
      );
    });

    if (isS3Upload) {
      // For S3: send raw file body without extra headers that might cause signature mismatch
      xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
      const body = rangeStart > 0 ? file.slice(rangeStart) : file;
      xhr.send(body);
    } else {
      // For UploadThing: send FormData
      const formData = new FormData();
      /**
       * iOS/React Native FormData handling requires special attention:
       *
       * Issue: In React Native, iOS crashes with "attempt to insert nil object" when appending File directly
       * to FormData. This happens because iOS tries to create NSDictionary from the file object and expects
       * specific structure {uri, type, name}.
       *
       *
       * Note: Don't try to use Blob or modify File object - iOS specifically needs plain object
       * with these properties to create valid NSDictionary.
       */
      if ("uri" in file) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        formData.append("file", {
          uri: file.uri as string,
          type: file.type,
          name: file.name,
          ...(rangeStart > 0 && { range: rangeStart }),
        } as any);
      } else {
        formData.append("file", rangeStart > 0 ? file.slice(rangeStart) : file);
      }
      xhr.send(formData);
    }

    return Micro.sync(() => xhr.abort());
  });

const isS3Url = (url: string): boolean => {
  return url.includes("X-Amz-Signature");
};

const triggerS3Completion = (
  fileUrl: string,
  file: File,
  presigned: NewPresignedUrl,
  opts: {
    traceHeaders: TraceHeaders;
  },
) => {
  // Get the slug from the page URL or presigned URL
  const params = new URLSearchParams(window.location.search);
  const slug = params.get("slug") || "videoAndImage"; // fallback slug

  console.log(
    "[triggerS3Completion] Triggering completion",
    { slug, fileKey: presigned.key, fileName: file.name },
  );

  return Micro.tryPromise({
    try: async () => {
      const completeUrl = `${window.location.origin}/api/uploadthing?actionType=complete&slug=${slug}`;
      console.log("[triggerS3Completion] POST to", completeUrl);

      const response = await fetch(completeUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "b3": opts.traceHeaders.b3,
          "traceparent": opts.traceHeaders.traceparent,
        },
        body: JSON.stringify({
          fileKey: presigned.key,
          fileName: file.name,
          fileSize: file.size,
          fileType: file.type,
          customId: presigned.customId,
        }),
      });

      const responseData = await response.json();
      console.log("[triggerS3Completion] Response:", response.status, responseData);

      if (!response.ok) {
        throw new Error(
          `Complete action failed: ${response.status} ${response.statusText}`,
        );
      }

      // Return the file data from the server response if available
      return responseData.file || responseData;
    },
    catch: (error) => {
      console.error("[triggerS3Completion] Error:", error);
      return new UploadThingError({
        code: "UPLOAD_FAILED",
        message: "Failed to complete S3 upload on server",
        cause: error,
      });
    },
  });
};

export const uploadFile = <
  TRouter extends FileRouter,
  TEndpoint extends keyof TRouter,
  TServerOutput = inferEndpointOutput<TRouter[TEndpoint]>,
>(
  file: File,
  presigned: NewPresignedUrl,
  opts: {
    traceHeaders: TraceHeaders;
    onUploadProgress?: (progressEvent: {
      loaded: number;
      delta: number;
    }) => void;
  },
) => {
  const s3Upload = isS3Url(presigned.url);

  return (
    s3Upload
      ? // For S3: skip HEAD request and upload directly
        Micro.succeed(0).pipe(
          Micro.tap((start) =>
            opts.onUploadProgress?.({
              delta: start,
              loaded: start,
            }),
          ),
          Micro.flatMap((start) =>
            uploadWithProgress(file, start, presigned, {
              traceHeaders: opts.traceHeaders,
              onUploadProgress: (progressEvent) =>
                opts.onUploadProgress?.({
                  delta: progressEvent.delta,
                  loaded: progressEvent.loaded + start,
                }),
            }),
          ),
          Micro.flatMap(() =>
            triggerS3Completion(presigned.url, file, presigned, {
              traceHeaders: opts.traceHeaders,
            }),
          ),
        )
      : // For UploadThing: use existing flow
        fetchEff(presigned.url, {
          method: "HEAD",
          headers: opts.traceHeaders,
        }).pipe(
          Micro.map(({ headers }) =>
            parseInt(headers.get("x-ut-range-start") ?? "0", 10),
          ),
          Micro.tap((start) =>
            opts.onUploadProgress?.({
              delta: start,
              loaded: start,
            }),
          ),
          Micro.flatMap((start) =>
            uploadWithProgress(file, start, presigned, {
              traceHeaders: opts.traceHeaders,
              onUploadProgress: (progressEvent) =>
                opts.onUploadProgress?.({
                  delta: progressEvent.delta,
                  loaded: progressEvent.loaded + start,
                }),
            }),
          ),
        )
  ).pipe(
    Micro.map(unsafeCoerce<unknown, UploadPutResult<TServerOutput>>),
    Micro.map((uploadResponse) => ({
      name: file.name,
      size: file.size,
      key: presigned.key,
      lastModified: file.lastModified,
      serverData: uploadResponse.serverData,
      get url() {
        logDeprecationWarning(
          "`file.url` is deprecated and will be removed in uploadthing v9. Use `file.ufsUrl` instead.",
        );
        return uploadResponse.url;
      },
      get appUrl() {
        logDeprecationWarning(
          "`file.appUrl` is deprecated and will be removed in uploadthing v9. Use `file.ufsUrl` instead.",
        );
        return uploadResponse.appUrl;
      },
      ufsUrl: uploadResponse.ufsUrl,
      customId: presigned.customId,
      type: file.type,
      fileHash: uploadResponse.fileHash,
    })),
  );
};

export const uploadFilesInternal = <
  TRouter extends FileRouter,
  TEndpoint extends keyof TRouter,
  TServerOutput = inferEndpointOutput<TRouter[TEndpoint]>,
>(
  endpoint: TEndpoint,
  opts: UploadFilesOptions<TRouter[TEndpoint]>,
): Micro.Micro<
  ClientUploadedFileData<TServerOutput>[],
  UploadThingError | FetchError,
  FetchContext
> => {
  // classic service right here
  const traceHeaders = generateTraceHeaders();
  const reportEventToUT = createUTReporter({
    endpoint: String(endpoint),
    package: opts.package,
    url: opts.url,
    headers: opts.headers,
    traceHeaders,
  });

  const totalSize = opts.files.reduce((acc, f) => acc + f.size, 0);
  let totalLoaded = 0;

  return Micro.flatMap(
    reportEventToUT("upload", {
      input: "input" in opts ? opts.input : null,
      files: opts.files.map((f) => ({
        name: f.name,
        size: f.size,
        type: f.type,
        lastModified: f.lastModified,
      })),
    }),
    (presigneds) =>
      Micro.forEach(
        presigneds,
        (presigned, i) =>
          Micro.flatMap(
            Micro.sync(() =>
              opts.onUploadBegin?.({ file: opts.files[i]!.name }),
            ),
            () =>
              uploadFile<TRouter, TEndpoint, TServerOutput>(
                opts.files[i]!,
                presigned,
                {
                  traceHeaders,
                  onUploadProgress: (ev) => {
                    totalLoaded += ev.delta;
                    opts.onUploadProgress?.({
                      file: opts.files[i]!,
                      progress: (ev.loaded / opts.files[i]!.size) * 100,
                      loaded: ev.loaded,
                      delta: ev.delta,
                      totalLoaded,
                      totalProgress: totalLoaded / totalSize,
                    });
                  },
                },
              ),
          ),
        { concurrency: 6 },
      ),
  );
};
