// Business logic for uploaded media. Knows nothing about HTTP (no req/res).
// Belongs here: e.g. deciding which files may be uploaded, and checking that an upload really finished before marking it ready.

import { randomUUID } from "node:crypto";
import * as db from "../db/index.js";
import * as storage from "../storage/objectStorage.js";
import { inspectStoredFile } from "./mediaInspection.js";

const MB = 1024 * 1024;
const VIDEO_MAX_BYTES = 500 * MB;
const IMAGE_MAX_BYTES = 20 * MB;

// Allowed types, with the file extension used for the stored object.
const ALLOWED_TYPES: Record<string, { extension: string; maxBytes: number }> = {
  "video/mp4": { extension: "mp4", maxBytes: VIDEO_MAX_BYTES },
  "video/webm": { extension: "webm", maxBytes: VIDEO_MAX_BYTES },
  "video/quicktime": { extension: "mov", maxBytes: VIDEO_MAX_BYTES },
  "image/jpeg": { extension: "jpg", maxBytes: IMAGE_MAX_BYTES },
  "image/png": { extension: "png", maxBytes: IMAGE_MAX_BYTES },
  "image/gif": { extension: "gif", maxBytes: IMAGE_MAX_BYTES },
  "image/webp": { extension: "webp", maxBytes: IMAGE_MAX_BYTES },
};

export const MAX_MEDIA_PER_POST = 4;
const UPLOAD_URL_SECONDS = 15 * 60;
const VIEW_URL_SECONDS = 60 * 60;

// Returns an error message, or null if a file of this type and size may be uploaded.
export function validateUpload(mimeType: unknown, sizeBytes: unknown): string | null {
  const rule = typeof mimeType === "string" ? ALLOWED_TYPES[mimeType] : undefined;
  if (!rule) return `mimeType must be one of: ${Object.keys(ALLOWED_TYPES).join(", ")}`;
  if (typeof sizeBytes !== "number" || !Number.isInteger(sizeBytes) || sizeBytes < 1) {
    return "sizeBytes must be a positive whole number";
  }
  if (sizeBytes > rule.maxBytes) {
    return `${mimeType} files can be at most ${rule.maxBytes / MB} MB`;
  }
  return null;
}

type StoredMedia = {
  id: string;
  objectKey: string;
  mimeType: string;
  sizeBytes: bigint;
  width: number | null;
  height: number | null;
  durationSeconds: { toNumber(): number } | null;
};

// The client-facing shape: no bucket or object key, sizes as plain numbers, and a temporary URL to view the file.
async function mediaView(media: StoredMedia & { uploadStatus?: db.UploadStatus }) {
  const ready = media.uploadStatus === undefined || media.uploadStatus === "ready";
  return {
    id: media.id,
    mimeType: media.mimeType,
    sizeBytes: Number(media.sizeBytes),
    width: media.width,
    height: media.height,
    durationSeconds: media.durationSeconds?.toNumber() ?? null,
    ...(media.uploadStatus ? { uploadStatus: media.uploadStatus } : {}),
    url: ready ? await storage.signDownload(media.objectKey, VIEW_URL_SECONDS) : null,
  };
}

// Step 1: records a pending upload and returns where to PUT the file.
export async function startUpload(ownerId: string, mimeType: string, sizeBytes: number) {
  const objectKey = `uploads/${ownerId}/${randomUUID()}.${ALLOWED_TYPES[mimeType]!.extension}`;
  const media = await db.createPendingMedia({ ownerId, bucket: storage.bucket, objectKey, mimeType, sizeBytes });
  const url = await storage.signUpload(objectKey, mimeType, sizeBytes, UPLOAD_URL_SECONDS);
  return {
    media: await mediaView(media),
    upload: {
      method: "PUT",
      url,
      headers: { "Content-Type": mimeType },
      expiresAt: new Date(Date.now() + UPLOAD_URL_SECONDS * 1000).toISOString(),
    },
  };
}

export type FinishResult =
  | { outcome: "ready"; media: Awaited<ReturnType<typeof mediaView>> }
  | { outcome: "not_found" }
  | { outcome: "not_uploaded" }
  | { outcome: "mismatch"; error: string }
  | { outcome: "not_pending"; status: db.UploadStatus };

// Step 2: after the client's PUT, checks what actually landed in storage before marking the media ready:
// the size and type it was uploaded with, then its contents (that it really is that kind of file, within
// the resolution and length limits). A file that fails is deleted and the media marked failed.
export async function finishUpload(mediaId: string, ownerId: string): Promise<FinishResult> {
  const media = await db.getMediaForOwner(mediaId, ownerId);
  if (!media) return { outcome: "not_found" };
  if (media.uploadStatus === "ready") return { outcome: "ready", media: await mediaView(media) };
  if (media.uploadStatus !== "pending") return { outcome: "not_pending", status: media.uploadStatus };

  const stored = await storage.statObject(media.objectKey);
  if (!stored) return { outcome: "not_uploaded" };

  const reject = async (error: string): Promise<FinishResult> => {
    await storage.deleteObject(media.objectKey);
    await db.failMedia(media.id, ownerId);
    return { outcome: "mismatch", error };
  };

  if (stored.sizeBytes !== Number(media.sizeBytes) || stored.mimeType !== media.mimeType) {
    return reject(
      `Uploaded file (${stored.mimeType ?? "unknown type"}, ${stored.sizeBytes} bytes) doesn't match the declared ${media.mimeType}, ${media.sizeBytes} bytes`,
    );
  }

  const inspection = await inspectStoredFile(media.objectKey, media.mimeType);
  if (!inspection.ok) return reject(inspection.error);

  const { width, height, durationSeconds } = inspection;
  await db.completeMedia(media.id, ownerId, { width, height, durationSeconds });
  const completed = await db.getMediaForOwner(media.id, ownerId);
  return completed ? { outcome: "ready", media: await mediaView(completed) } : { outcome: "not_found" };
}

// Deletes media rows, then their files in storage. Media still on a post or used as an avatar is skipped.
// The row goes first so a post can never point at a missing file; if storage then fails, the file is
// left behind (and logged) rather than breaking anything. Returns how many were deleted.
export async function purgeMedia(media: { id: string; objectKey: string }[]): Promise<number> {
  let deleted = 0;
  for (const item of media) {
    if ((await db.deleteUnusedMedia([item.id])) === 0) continue;
    deleted++;
    try {
      await storage.deleteObject(item.objectKey);
    } catch (err) {
      console.error(`Deleted media ${item.id} but couldn't delete ${item.objectKey} from storage`, err);
    }
  }
  return deleted;
}

// How long abandoned uploads are kept. Upload URLs last 15 minutes, so an hour leaves plenty of slack.
const ABANDONED_PENDING_MS = 60 * 60 * 1000;
const ABANDONED_FAILED_MS = 60 * 60 * 1000;
// Finished uploads that never made it onto a post (the user uploaded, then left without posting).
const ABANDONED_UNATTACHED_MS = 24 * 60 * 60 * 1000;

// Deletes uploads that were never finished, failed, or never used, in batches. Returns how many were removed.
export async function cleanUpAbandonedMedia(now = new Date()): Promise<number> {
  const cutoffs = {
    pending: new Date(now.getTime() - ABANDONED_PENDING_MS),
    failed: new Date(now.getTime() - ABANDONED_FAILED_MS),
    unattached: new Date(now.getTime() - ABANDONED_UNATTACHED_MS),
  };
  let total = 0;
  for (;;) {
    const batch = await db.findAbandonedMedia(cutoffs);
    if (!batch.length) return total;
    const removed = await purgeMedia(batch);
    total += removed;
    if (removed === 0) return total; // Everything left was claimed in the meantime.
  }
}

export async function getOwnMedia(mediaId: string, ownerId: string) {
  const media = await db.getMediaForOwner(mediaId, ownerId);
  if (!media) return null;
  return { ...(await mediaView(media)), postId: media.postMedia?.postId ?? null };
}

// Returns an error message, or null if every ID can go on a new post by ownerId.
export async function checkAttachable(mediaIds: string[], ownerId: string): Promise<string | null> {
  const attachable = await db.findAttachableMediaIds(mediaIds, ownerId);
  const unavailable = mediaIds.filter((id) => !attachable.has(id));
  return unavailable.length
    ? `These media can't be attached (not yours, not finished uploading, or already on a post): ${unavailable.join(", ")}`
    : null;
}

type PostWithMedia = { media: { position: number; media: StoredMedia }[] };

// Replaces a post's stored media rows with client-facing media, in display order.
export async function withMediaUrls<T extends PostWithMedia>(post: T) {
  return { ...post, media: await Promise.all(post.media.map(({ media }) => mediaView(media))) };
}
