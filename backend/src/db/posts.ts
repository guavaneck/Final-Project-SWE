import { randomUUID } from "node:crypto";
import type { PostType } from "../generated/prisma/enums.js";
import { prisma } from "./client.js";

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

export function createPost(input: CreatePostInput) {
  return prisma.post.create({ data: { id: randomUUID(), ...input } });
}

export function getPostById(id: string) {
  return prisma.post.findFirst({ where: { id, deletedAt: null } });
}

export function listCommunityPosts(communityId: string, limit = 20, cursor?: PageCursor) {
  return prisma.post.findMany({
    where: { communityId, deletedAt: null, ...beforeCursor(cursor) },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: Math.min(Math.max(limit, 1), 100),
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
  });
}

export async function updatePost(
  id: string,
  authorId: string,
  changes: { title: string; body?: string; externalUrl?: string },
) {
  const existing = await prisma.post.findFirst({ where: { id, authorId, deletedAt: null } });
  if (!existing) return null;
  return prisma.post.update({ where: { id }, data: { ...changes, updatedAt: new Date() } });
}

export async function deletePost(id: string, authorId: string): Promise<boolean> {
  const result = await prisma.post.updateMany({
    where: { id, authorId, deletedAt: null },
    data: { body: null, externalUrl: null, deletedAt: new Date(), updatedAt: new Date() },
  });
  return result.count === 1;
}

export function createComment(postId: string, authorId: string, body: string, parentId?: string) {
  return prisma.comment.create({
    data: { id: randomUUID(), postId, authorId, body, parentId },
  });
}

export function listComments(postId: string) {
  return prisma.comment.findMany({
    where: { postId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
}

export async function deleteComment(id: string, authorId: string): Promise<boolean> {
  const result = await prisma.comment.updateMany({
    where: { id, authorId, deletedAt: null },
    data: { body: null, deletedAt: new Date(), updatedAt: new Date() },
  });
  return result.count === 1;
}
