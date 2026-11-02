import { randomUUID } from "node:crypto";
import type { PostType } from "../generated/prisma/enums.js";
import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "./client.js";
import { generatePublicId } from "./publicId.js";

const withPostDetails = {
  author: { select: { username: true } },
  _count: { select: { likes: true } },
} as const;

const withCommentDetails = {
  author: { select: { username: true } },
  _count: { select: { likes: true } },
} as const;

export interface PageCursor {
  createdAt: Date;
  id: string;
}

export interface CreatePostInput {
  authorId: string;
  communityId: string;
  postType: PostType;
  title: string;
  body?: string;
  externalUrl?: string;
}

function beforeCursor(cursor?: PageCursor) {
  if (!cursor) return {};
  return {
    OR: [
      { createdAt: { lt: cursor.createdAt } },
      { createdAt: cursor.createdAt, id: { lt: cursor.id } },
    ],
  };
}

export async function createPost(input: CreatePostInput) {
  // A public ID collision is astronomically unlikely, but retry on one rather than fail the request.
  for (let attempt = 1; ; attempt++) {
    try {
      return await prisma.post.create({
        data: { id: randomUUID(), publicId: generatePublicId(), ...input },
        include: withPostDetails,
      });
    } catch (err) {
      const collided = err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
      if (!collided || attempt === 3) throw err;
    }
  }
}

export function getPostById(id: string) {
  return prisma.post.findFirst({ where: { id, deletedAt: null }, include: withPostDetails });
}

export function getPostByPublicId(publicId: string) {
  return prisma.post.findFirst({ where: { publicId, deletedAt: null }, include: withPostDetails });
}

export function listCommunityPosts(communityId: string, limit = 20, cursor?: PageCursor) {
  return prisma.post.findMany({
    where: { communityId, deletedAt: null, ...beforeCursor(cursor) },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: Math.min(Math.max(limit, 1), 100),
    include: withPostDetails,
  });
}

export function listHomeFeed(userId: string, limit = 20, cursor?: PageCursor) {
  return prisma.post.findMany({
    where: {
      deletedAt: null,
      AND: [
        beforeCursor(cursor),
        {
          OR: [
            { authorId: userId },
            { community: { memberships: { some: { userId } } } },
            { author: { followers: { some: { followerId: userId } } } },
          ],
        },
      ],
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: Math.min(Math.max(limit, 1), 100),
    include: withPostDetails,
  });
}

export async function updatePost(
  id: string,
  authorId: string,
  // Omitted fields are left as they are; null clears a field.
  changes: { title?: string; body?: string | null; externalUrl?: string | null },
) {
  const existing = await prisma.post.findFirst({ where: { id, authorId, deletedAt: null } });
  if (!existing) return null;
  return prisma.post.update({
    where: { id },
    data: { ...changes, updatedAt: new Date() },
    include: withPostDetails,
  });
}

export async function deletePost(id: string, authorId: string): Promise<boolean> {
  const result = await prisma.post.updateMany({
    where: { id, authorId, deletedAt: null },
    data: { body: null, externalUrl: null, deletedAt: new Date(), updatedAt: new Date() },
  });
  return result.count === 1;
}

// Returns null when parentId is given but no such comment exists on this post, or it was deleted.
export async function createComment(postId: string, authorId: string, body: string, parentId?: string) {
  let depth = 0;
  if (parentId) {
    const parent = await prisma.comment.findFirst({
      where: { id: parentId, postId, deletedAt: null },
      select: { depth: true },
    });
    if (!parent) return null;
    depth = parent.depth + 1;
  }
  return prisma.comment.create({
    data: { id: randomUUID(), postId, authorId, body, parentId, depth },
    include: withCommentDetails,
  });
}

// Returns null when the comment doesn't exist, was deleted, or wasn't written by authorId.
export async function updateComment(id: string, authorId: string, body: string) {
  const existing = await prisma.comment.findFirst({ where: { id, authorId, deletedAt: null } });
  if (!existing) return null;
  return prisma.comment.update({
    where: { id },
    data: { body, updatedAt: new Date() },
    include: withCommentDetails,
  });
}

export function getCommentOnPost(commentId: string, postId: string) {
  return prisma.comment.findFirst({
    where: { id: commentId, postId, deletedAt: null },
    select: { id: true },
  });
}

export function listComments(postId: string) {
  return prisma.comment.findMany({
    where: { postId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    include: withCommentDetails,
  });
}

export async function deleteComment(id: string, authorId: string): Promise<boolean> {
  const result = await prisma.comment.updateMany({
    where: { id, authorId, deletedAt: null },
    data: { body: null, deletedAt: new Date(), updatedAt: new Date() },
  });
  return result.count === 1;
}
