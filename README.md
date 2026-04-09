<p align="center">
  <picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/pingdotgg/uploadthing/main/assets/uploadthing-logo-dark-background.svg">
  <img src="https://github.com/pingdotgg/uploadthing/blob/main/assets/uploadthing-logo-light-background.svg" width="480" height="80" alt="Logo for UploadThing">
</picture>
</p>

<p align="center">
  A thing for uploading files.
</p>

<div align="center">
  <a href="https://uploadthing.com">Home</a> | <a href="https://docs.uploadthing.com">Docs</a> | <a href="https://t3-tools.notion.site/776334c06d814dd08d450975bb983085">Roadmap</a>
</div>

## Table of Contents

This repository contains the packages, docs and examples for uploadthing

- [Next.js App Directory](https://github.com/pingdotgg/uploadthing/tree/main/examples/minimal-appdir) -
  A simple example using the Next.js app directory
- [Next.js Pages Directory](https://github.com/pingdotgg/uploadthing/tree/main/examples/minimal-pagedir) -
  A simple example using the Next.js pages directory
- [SolidStart SSR](https://github.com/pingdotgg/uploadthing/tree/main/examples/minimal-solidstart) -
  A simple example using SSR with SolidStart
- [Docs Site](https://github.com/pingdotgg/uploadthing/tree/main/docs) - Source
  for docs.uploadthing.com
- [React Package](https://github.com/pingdotgg/uploadthing/tree/main/packages/react) -
  _@uploadthing/react_ - the components and hooks for using uploadthing in your
  React projects
- [Solid Package](https://github.com/pingdotgg/uploadthing/tree/main/packages/solid) -
  _@uploadthing/solid_ - the components and hooks for using uploadthing in your
  Solid projects
- [uploadthing](https://github.com/pingdotgg/uploadthing/tree/main/packages/uploadthing) -
  server/client stuff (framework agnostic)

[Report an Issue](https://github.com/pingdotgg/uploadthing/issues/new)

## Custom S3 Backend Integration

This fork includes support for uploading directly to S3-compatible storage (AWS S3, Cloudflare R2, MinIO, etc.) instead of using UploadThing's managed infrastructure.

### Features

- **Direct S3 Uploads** — Files upload directly to your S3-compatible provider without going through UploadThing
- **Presigned URLs** — AWS SigV4 signing for secure, temporary access URLs
- **Public URL Support** — Automatic public URL generation in `onUploadComplete` callback
- **Provider Compatibility** — Works with AWS S3, Cloudflare R2, MinIO, Wasabi, DigitalOcean Spaces, Backblaze B2, and more
- **Progress Tracking** — Client-side upload progress events
- **Region Handling** — Flexible region configuration or auto-region support

### Quick Start

1. Set environment variables in `.env.local` (copy from `.env.local.example`):

```bash
UPLOADTHING_S3_ENDPOINT=https://YOUR_ACCOUNT_ID.r2.cloudflarestorage.com
UPLOADTHING_S3_BUCKET=your-bucket-name
UPLOADTHING_S3_ACCESS_KEY=your-access-key
UPLOADTHING_S3_SECRET_KEY=your-secret-key
UPLOADTHING_S3_REGION=us-east-1
UPLOADTHING_S3_PUBLIC_URL=https://pub-YOUR_ACCOUNT_ID.r2.dev
```

2. The SDK automatically detects S3 configuration and routes uploads accordingly

3. Your `onUploadComplete` callback receives the public file URL:

```typescript
onUploadComplete({ file }) {
  console.log("File uploaded!", file.ufsUrl); 
  // https://pub-YOUR_ACCOUNT_ID.r2.dev/FILE_KEY
}
```

### Configuration

All S3 environment variables are optional. If not set, UploadThing uses its managed infrastructure.

| Variable | Required | Description | Example |
|---|---|---|---|
| `UPLOADTHING_S3_ENDPOINT` | Yes* | S3 API endpoint URL | `https://4f93...r2.cloudflarestorage.com` |
| `UPLOADTHING_S3_BUCKET` | Yes* | S3 bucket name | `my-uploads` |
| `UPLOADTHING_S3_ACCESS_KEY` | Yes* | S3 access key ID | (from provider) |
| `UPLOADTHING_S3_SECRET_KEY` | Yes* | S3 secret access key | (from provider) |
| `UPLOADTHING_S3_REGION` | No | S3 region (default: `us-east-1`) | `us-east-1`, `auto` |
| `UPLOADTHING_S3_PUBLIC_URL` | Yes* | Public base URL for files | `https://pub-950369aa.r2.dev` |

*Must set all 4 "Yes" vars to enable custom S3. If any are missing, UploadThing uses its managed infrastructure.

### CORS Configuration

To allow browser uploads directly to your S3 provider, configure CORS on your bucket:

#### Cloudflare R2

R2 CORS is automatically open for public buckets. For private buckets, add in bucket settings:

```json
[
  {
    "allowedOrigins": ["https://yourdomain.com"],
    "allowedMethods": ["PUT", "POST"],
    "allowedHeaders": ["*"],
    "maxAgeSeconds": 3600
  }
]
```

#### AWS S3

In S3 bucket settings → CORS:

```json
[
  {
    "AllowedOrigins": ["https://yourdomain.com"],
    "AllowedMethods": ["PUT", "POST"],
    "AllowedHeaders": ["*"],
    "MaxAgeSeconds": 3600
  }
]
```

#### MinIO

CORS is handled via bucket policy. Uploads work within the same domain or via presigned URLs.

### Provider-Specific Guides

#### Cloudflare R2

1. Create R2 bucket and generate API token
2. Get account ID from R2 settings
3. Set `UPLOADTHING_S3_PUBLIC_URL` to your public R2 domain (if public bucket)

```bash
UPLOADTHING_S3_ENDPOINT=https://ACCOUNT_ID.r2.cloudflarestorage.com
UPLOADTHING_S3_BUCKET=bucket-name
UPLOADTHING_S3_ACCESS_KEY=token-access-key
UPLOADTHING_S3_SECRET_KEY=token-secret-key
UPLOADTHING_S3_REGION=us-east-1
UPLOADTHING_S3_PUBLIC_URL=https://pub-ACCOUNT_ID.r2.dev
```

#### AWS S3

1. Create S3 bucket and IAM user with `s3:PutObject` permission
2. Generate access key for IAM user
3. Use actual region of your bucket

```bash
UPLOADTHING_S3_ENDPOINT=https://s3.amazonaws.com
UPLOADTHING_S3_BUCKET=my-bucket
UPLOADTHING_S3_ACCESS_KEY=AKIAIOSFODNN7EXAMPLE
UPLOADTHING_S3_SECRET_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
UPLOADTHING_S3_REGION=us-west-2
UPLOADTHING_S3_PUBLIC_URL=https://my-bucket.s3.us-west-2.amazonaws.com
```

#### MinIO

1. Deploy MinIO or use managed service
2. Generate access/secret keys
3. Region can be any string (e.g., `minio`)

```bash
UPLOADTHING_S3_ENDPOINT=https://minio.example.com:9000
UPLOADTHING_S3_BUCKET=uploads
UPLOADTHING_S3_ACCESS_KEY=minioadmin
UPLOADTHING_S3_SECRET_KEY=minioadmin
UPLOADTHING_S3_REGION=minio
UPLOADTHING_S3_PUBLIC_URL=https://minio.example.com/uploads
```

### Region Handling

- **AWS S3**: Use the actual region where your bucket is located (us-east-1, eu-west-1, etc.)
- **Cloudflare R2**: Any value accepted, typically `us-east-1` or `auto`
- **MinIO**: Any string value accepted
- **Other providers**: Check their documentation; most accept any value

The region value is embedded in the presigned URL signature, so it must be a value your provider accepts, but doesn't need to be geographically accurate.

### Client Usage

Files uploaded to custom S3 backends appear in `onClientUploadComplete`:

```typescript
import { UploadButton } from "@uploadthing/react";

export function FileUploader() {
  return (
    <UploadButton
      endpoint="imageUploader"
      onClientUploadComplete={(files) => {
        files.forEach(file => {
          console.log("Name:", file.name);
          console.log("Size:", file.size);
          console.log("Public URL:", file.ufsUrl); // S3 public URL
          console.log("Custom ID:", file.customId);
        });
      }}
    />
  );
}
```

### How It Works

1. **Client requests presigned URL** → Server generates AWS SigV4 presigned PUT URL
2. **Client uploads file directly** → Browser PUTs file body to S3 presigned URL
3. **Client triggers completion** → Browser POSTs completion request to `/api/uploadthing?actionType=complete`
4. **Server calls `onUploadComplete`** → Callback receives file object with public URL
5. **Client receives file data** → `onClientUploadComplete` hook receives full file object including `ufsUrl`

### Debugging

Enable debug logging by setting `DEBUG=uploadthing:*` environment variable. You'll see:

- Presigned URL generation
- S3 upload details
- Completion action payload
- `onUploadComplete` callback execution

```bash
DEBUG=uploadthing:* pnpm dev
```

## Contributing

All UploadThing SDKs are open source and we welcome contributions from the
community.

<!-- prettier-ignore -->
> [!NOTE] 
> If your change also requires infrastructure changes, please reach out
> and we can work together to make the necessary changes on our end.

<!-- prettier-ignore-end -->

1. Fork and clone the repository
2. Ensure you have the LTS version of Node.js installed, as well as the latest
   version of [pnpm](https://pnpm.io).
3. Install the project dependencies by running `pnpm install`.
4. Implement your changes, as well as any documentation or tests that are
   required.
5. Create a changeset for your changes by running `pnpm changeset`.
6. Open a pull request with your changes and changeset.
