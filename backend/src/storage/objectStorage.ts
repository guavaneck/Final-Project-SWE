// Talks to the S3-compatible object store (SeaweedFS locally) where uploaded files live. Knows nothing about HTTP or the database.
// Belongs here: e.g. signing a URL the browser can PUT a file to, or checking what actually landed in the bucket.

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  NotFound,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Readable } from "node:stream";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export const bucket = process.env.S3_BUCKET ?? "media";

// The API reaches storage at S3_ENDPOINT. Browsers use S3_PUBLIC_ENDPOINT, which differs when storage
// sits behind another hostname. A signed URL covers its host, so each endpoint needs its own client.
const endpoint = process.env.S3_ENDPOINT ?? `http://localhost:${process.env.S3_PORT ?? 8333}`;
const publicEndpoint = process.env.S3_PUBLIC_ENDPOINT ?? endpoint;

function createClient(clientEndpoint: string) {
  return new S3Client({
    endpoint: clientEndpoint,
    region: process.env.S3_REGION ?? "us-east-1",
    forcePathStyle: true,
    // By default the SDK adds a body checksum to every PutObject. In a signed upload URL that checksum is
    // computed before the file exists, so storage rejects the real upload. Only send checksums when required.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
    credentials: { accessKeyId: required("S3_ACCESS_KEY"), secretAccessKey: required("S3_SECRET_KEY") },
  });
}

let internalClient: S3Client | undefined;
let publicClient: S3Client | undefined;
const internal = () => (internalClient ??= createClient(endpoint));
const forBrowsers = () => (publicClient ??= createClient(publicEndpoint));

// A URL the client can PUT the file to directly. The content type and length are signed,
// so storage rejects an upload that doesn't match what was declared.
export function signUpload(objectKey: string, mimeType: string, sizeBytes: number, expiresInSeconds: number) {
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: objectKey,
    ContentType: mimeType,
    ContentLength: sizeBytes,
  });
  return getSignedUrl(forBrowsers(), command, {
    expiresIn: expiresInSeconds,
    signableHeaders: new Set(["content-type", "content-length"]),
  });
}

// A temporary URL for viewing or downloading a stored file.
export function signDownload(objectKey: string, expiresInSeconds: number) {
  return getSignedUrl(forBrowsers(), new GetObjectCommand({ Bucket: bucket, Key: objectKey }), {
    expiresIn: expiresInSeconds,
  });
}

// Streams a stored file, e.g. into ffprobe. Destroy the stream to stop downloading early.
export async function openObjectStream(objectKey: string): Promise<Readable> {
  const result = await internal().send(new GetObjectCommand({ Bucket: bucket, Key: objectKey }));
  if (!(result.Body instanceof Readable)) throw new Error(`No readable body for ${objectKey}`);
  return result.Body;
}

// The first `length` bytes of a stored file, for checking file headers without downloading the whole thing.
export async function readObjectStart(objectKey: string, length: number): Promise<Uint8Array> {
  const result = await internal().send(
    new GetObjectCommand({ Bucket: bucket, Key: objectKey, Range: `bytes=0-${length - 1}` }),
  );
  return result.Body ? await result.Body.transformToByteArray() : new Uint8Array();
}

// What's actually stored under a key, or null if nothing has been uploaded there.
export async function statObject(objectKey: string) {
  try {
    const head = await internal().send(new HeadObjectCommand({ Bucket: bucket, Key: objectKey }));
    return { sizeBytes: head.ContentLength ?? 0, mimeType: head.ContentType ?? null };
  } catch (err) {
    if (err instanceof NotFound || (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) {
      return null;
    }
    throw err;
  }
}

export async function deleteObject(objectKey: string): Promise<void> {
  await internal().send(new DeleteObjectCommand({ Bucket: bucket, Key: objectKey }));
}
