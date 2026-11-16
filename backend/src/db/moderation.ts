import { prisma } from "./client.js";

const withUser = { user: { select: { id: true, username: true, displayName: true } } } as const;

export const MAX_PINNED_POSTS = 3;

export async function isModerator(communityId: string, userId: string): Promise<boolean> {
  const row = await prisma.communityModerator.findUnique({
    where: { communityId_userId: { communityId, userId } },
    select: { userId: true },
  });
  return row !== null;
}

export function listModerators(communityId: string) {
  return prisma.communityModerator.findMany({
    where: { communityId },
    orderBy: { createdAt: "asc" },
    select: { createdAt: true, ...withUser },
  });
}

export async function addModerator(communityId: string, userId: string, addedById: string): Promise<void> {
  await prisma.communityModerator.upsert({
    where: { communityId_userId: { communityId, userId } },
    create: { communityId, userId, addedById },
    update: {},
  });
}

// Returns "last" instead of removing the community's only moderator, and "missing" if userId isn't one.
export async function removeModerator(communityId: string, userId: string): Promise<"removed" | "last" | "missing"> {
  return prisma.$transaction(async (transaction) => {
    // Lock the community so two moderators removing each other at once can't leave it with none.
    await transaction.$queryRaw`SELECT id FROM communities WHERE id = ${communityId}::uuid FOR UPDATE`;
    const moderators = await transaction.communityModerator.findMany({
      where: { communityId },
      select: { userId: true },
    });
    if (!moderators.some((moderator) => moderator.userId === userId)) return "missing";
    if (moderators.length === 1) return "last";
    await transaction.communityModerator.delete({ where: { communityId_userId: { communityId, userId } } });
    return "removed";
  });
}

export async function isBanned(communityId: string, userId: string): Promise<boolean> {
  const row = await prisma.communityBan.findUnique({
    where: { communityId_userId: { communityId, userId } },
    select: { userId: true },
  });
  return row !== null;
}

export function listBans(communityId: string) {
  return prisma.communityBan.findMany({
    where: { communityId },
    orderBy: { createdAt: "desc" },
    select: {
      reason: true,
      createdAt: true,
      ...withUser,
      bannedBy: { select: { id: true, username: true } },
    },
  });
}

// Banning also removes the user's membership. Banning someone already banned updates the reason.
export async function banUser(communityId: string, userId: string, bannedById: string, reason?: string) {
  await prisma.$transaction([
    prisma.communityBan.upsert({
      where: { communityId_userId: { communityId, userId } },
      create: { communityId, userId, bannedById, reason },
      update: { reason },
    }),
    prisma.communityMembership.deleteMany({ where: { communityId, userId } }),
  ]);
}

export async function unbanUser(communityId: string, userId: string): Promise<boolean> {
  const result = await prisma.communityBan.deleteMany({ where: { communityId, userId } });
  return result.count === 1;
}

// Returns false instead of pinning past MAX_PINNED_POSTS. Pinning a pinned post keeps its original pinnedAt.
export async function pinPost(postId: string, communityId: string): Promise<boolean> {
  return prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT id FROM communities WHERE id = ${communityId}::uuid FOR UPDATE`;
    const pinned = await transaction.post.findMany({
      where: { communityId, pinnedAt: { not: null }, deletedAt: null },
      select: { id: true },
    });
    if (pinned.some((post) => post.id === postId)) return true;
    if (pinned.length >= MAX_PINNED_POSTS) return false;
    await transaction.post.update({ where: { id: postId }, data: { pinnedAt: new Date() } });
    return true;
  });
}

export async function unpinPost(postId: string): Promise<void> {
  await prisma.post.update({ where: { id: postId }, data: { pinnedAt: null } });
}
