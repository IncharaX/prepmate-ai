/**
 * Cloudflare R2 client (S3-compatible) — used for resume PDF storage.
 *
 * Reads credentials from env at first call. No keys are exposed to the browser;
 * downloads happen via presigned URLs issued by our server with a short TTL.
 *
 * Required env:
 *   CLOUDFLARE_R2_ACCOUNT_ID
 *   CLOUDFLARE_R2_ACCESS_KEY_ID
 *   CLOUDFLARE_R2_SECRET_ACCESS_KEY
 *   CLOUDFLARE_R2_BUCKET
 */
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

let cachedClient: S3Client | null = null;
let cachedBucket: string | null = null;

function getR2Config(): { client: S3Client; bucket: string } {
  if (cachedClient && cachedBucket) {
    return { client: cachedClient, bucket: cachedBucket };
  }

  const accountId = process.env.CLOUDFLARE_R2_ACCOUNT_ID;
  const accessKeyId = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY;
  const bucket = process.env.CLOUDFLARE_R2_BUCKET;

  const missing: string[] = [];
  if (!accountId) missing.push("CLOUDFLARE_R2_ACCOUNT_ID");
  if (!accessKeyId) missing.push("CLOUDFLARE_R2_ACCESS_KEY_ID");
  if (!secretAccessKey) missing.push("CLOUDFLARE_R2_SECRET_ACCESS_KEY");
  if (!bucket) missing.push("CLOUDFLARE_R2_BUCKET");
  if (missing.length) {
    throw new Error(
      `R2 storage not configured. Set these env vars in .env: ${missing.join(", ")}. See .env.example for details.`,
    );
  }

  cachedClient = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: accessKeyId!,
      secretAccessKey: secretAccessKey!,
    },
  });
  cachedBucket = bucket!;
  return { client: cachedClient, bucket: cachedBucket };
}

export async function uploadFile(params: {
  key: string;
  body: Buffer | Uint8Array;
  contentType: string;
  contentLength?: number;
}): Promise<void> {
  const { client, bucket } = getR2Config();
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: params.key,
      Body: params.body,
      ContentType: params.contentType,
      ContentLength: params.contentLength,
    }),
  );
}

/**
 * Issue a short-lived presigned download URL. Default TTL 15 minutes — long
 * enough for a detail page to render and the user to click through, short
 * enough that a leaked URL is near-useless.
 */
export async function getSignedDownloadUrl(key: string, ttlSeconds = 15 * 60): Promise<string> {
  const { client, bucket } = getR2Config();
  return getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), {
    expiresIn: ttlSeconds,
  });
}

export async function deleteFile(key: string): Promise<void> {
  const { client, bucket } = getR2Config();
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}
