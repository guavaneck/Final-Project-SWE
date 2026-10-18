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

export async function completeMedia(id: string, ownerId: string): Promise<boolean> {
  const result = await prisma.mediaObject.updateMany({
    where: { id, ownerId, uploadStatus: "pending" },
    data: { uploadStatus: "ready", completedAt: new Date() },
  });
  return result.count === 1;
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
