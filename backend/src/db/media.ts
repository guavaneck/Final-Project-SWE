import { randomUUID } from "node:crypto";
import { prisma } from "./client.js";

export interface CreateMediaInput {
  ownerId: string;
  bucket: string;
  objectKey: string;
  mimeType: string;
  sizeBytes: number;
  checksumSha256?: string;
}

export function createPendingMedia(input: CreateMediaInput) {
  return prisma.mediaObject.create({
    data: { id: randomUUID(), ...input, sizeBytes: BigInt(input.sizeBytes) },
  });
}

export function getMediaForOwner(id: string, ownerId: string) {
  return prisma.mediaObject.findFirst({
    where: { id, ownerId },
    include: { postMedia: { select: { postId: true } } },
  });
}

export interface MediaDetails {
  width?: number | null;
  height?: number | null;
  durationSeconds?: number | null;
}

export async function completeMedia(id: string, ownerId: string, details: MediaDetails = {}): Promise<boolean> {
  const result = await prisma.mediaObject.updateMany({
    where: { id, ownerId, uploadStatus: "pending" },
    data: { ...details, uploadStatus: "ready", completedAt: new Date() },
  });
  return result.count === 1;
}

export async function failMedia(id: string, ownerId: string): Promise<boolean> {
  const result = await prisma.mediaObject.updateMany({
    where: { id, ownerId, uploadStatus: "pending" },
    data: { uploadStatus: "failed", completedAt: new Date() },
  });
  return result.count === 1;
}

// Media nothing points at: not on a post and not anyone's avatar. Only these may be deleted.
const unused = { postMedia: null, avatarFor: { none: {} } } as const;

// Uploads that were abandoned: never finished, failed, or finished but never put on a post.
// Each cutoff is "older than this"; pending and failed uploads are judged by when they started.
export function findAbandonedMedia(cutoffs: { pending: Date; failed: Date; unattached: Date }, limit = 500) {
  return prisma.mediaObject.findMany({
    where: {
      ...unused,
      OR: [
        { uploadStatus: "pending", createdAt: { lt: cutoffs.pending } },
        { uploadStatus: "failed", createdAt: { lt: cutoffs.failed } },
        { uploadStatus: "ready", completedAt: { lt: cutoffs.unattached } },
      ],
    },
    select: { id: true, objectKey: true },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
}

// Deletes media rows, skipping any that are still on a post or used as an avatar. Returns how many went.
export async function deleteUnusedMedia(ids: string[]): Promise<number> {
  const result = await prisma.mediaObject.deleteMany({ where: { id: { in: ids }, ...unused } });
  return result.count;
}

// The subset of ids that ownerId can attach to a new post: uploaded, theirs, and not on another post.
export async function findAttachableMediaIds(ids: string[], ownerId: string): Promise<Set<string>> {
  const rows = await prisma.mediaObject.findMany({
    where: { id: { in: ids }, ownerId, uploadStatus: "ready", postMedia: null },
    select: { id: true },
  });
  return new Set(rows.map((row) => row.id));
}

export async function attachMediaToPost(
  mediaId: string,
  postId: string,
  ownerId: string,
  position: number,
): Promise<void> {
  await prisma.$transaction(async (transaction) => {
    const [post, media] = await Promise.all([
      transaction.post.findFirst({ where: { id: postId, authorId: ownerId, deletedAt: null } }),
      transaction.mediaObject.findFirst({ where: { id: mediaId, ownerId, uploadStatus: "ready" } }),
    ]);
    if (!post || !media) throw new Error("Post or ready media not found for owner");
    await transaction.postMedia.create({ data: { postId, mediaId, position } });
  });
}
