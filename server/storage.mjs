// Guiyan object storage — Neon Object Storage (S3-compatible).
//
// Wired to the env vars `neon deploy` injects into .env.local:
//   AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY  (branch-scoped storage credential)
//   AWS_ENDPOINT_URL_S3                      (branch S3 endpoint)
//   AWS_REGION                               (ap-southeast-1)
// Bucket "uploads" is declared in neon.ts and already exists on the
// production branch. Path-style addressing is REQUIRED for Neon storage
// (virtual-hosted style is not supported), and signing is SigV4 only.
//
// The storage client is fail-soft: createStorage() returns null when the
// env vars are missing, and the /api/storage/* routes answer 503 with a
// clear message instead of crashing the server. DATABASE_URL stays
// fail-fast (see server.mjs); storage is optional for local dev.

import {
  S3Client,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export const STORAGE_BUCKET = "uploads";

// A storage key is a flat path inside the bucket: 1-512 chars, no leading
// slash, no ".." segment, no backslash, no control characters.
export function validKey(key) {
  return (
    typeof key === "string" &&
    key.length >= 1 &&
    key.length <= 512 &&
    !key.startsWith("/") &&
    !key.includes("\\") &&
    !key.split("/").includes("..") &&
    // eslint-disable-next-line no-control-regex
    !/[\u0000-\u001f\u007f]/.test(key)
  );
}

export function createStorage() {
  const {
    AWS_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY,
    AWS_ENDPOINT_URL_S3,
    AWS_REGION,
  } = process.env;
  if (
    !AWS_ACCESS_KEY_ID ||
    !AWS_SECRET_ACCESS_KEY ||
    !AWS_ENDPOINT_URL_S3 ||
    !AWS_REGION
  )
    return null;
  const client = new S3Client({
    region: AWS_REGION,
    endpoint: AWS_ENDPOINT_URL_S3,
    forcePathStyle: true,
    credentials: {
      accessKeyId: AWS_ACCESS_KEY_ID,
      secretAccessKey: AWS_SECRET_ACCESS_KEY,
    },
  });
  return {
    bucket: STORAGE_BUCKET,
    configured: true,
    async health() {
      await client.send(new HeadBucketCommand({ Bucket: STORAGE_BUCKET }));
      return { ok: true, bucket: STORAGE_BUCKET };
    },
    async put(key, body, contentType) {
      const out = await client.send(
        new PutObjectCommand({
          Bucket: STORAGE_BUCKET,
          Key: key,
          Body: body,
          ContentType: contentType || "application/octet-stream",
        }),
      );
      return { key, size: body.length, etag: out.ETag || null };
    },
    async presignedGet(key, expiresIn = 3600) {
      const url = await getSignedUrl(
        client,
        new GetObjectCommand({ Bucket: STORAGE_BUCKET, Key: key }),
        { expiresIn },
      );
      return { url, key, expires_in: expiresIn };
    },
    async exists(key) {
      try {
        await client.send(
          new HeadObjectCommand({ Bucket: STORAGE_BUCKET, Key: key }),
        );
        return true;
      } catch (e) {
        if (e?.$metadata?.httpStatusCode === 404 || e?.name === "NotFound")
          return false;
        throw e;
      }
    },
    async remove(key) {
      await client.send(
        new DeleteObjectCommand({ Bucket: STORAGE_BUCKET, Key: key }),
      );
      return { key, deleted: true };
    },
  };
}
