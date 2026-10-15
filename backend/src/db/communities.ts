import { randomUUID } from "node:crypto";
import type { Visibility } from "../generated/prisma/enums.js";
import { prisma } from "./client.js";

export interface CreateCommunityInput {
  creatorId: string;
  slug: string;
  name: string;
  description?: string;
  visibility?: Visibility;
}

export function createCommunity(input: CreateCommunityInput) {
  const { creatorId, ...community } = input;
  return prisma.community.create({
    data: {
      id: randomUUID(),
      creatorId,
      ...community,
      memberships: { create: { userId: creatorId } },
    },
  });
}

export async function joinCommunity(communityId: string, userId: string): Promise<void> {
  await prisma.communityMembership.upsert({
    where: { communityId_userId: { communityId, userId } },
    create: { communityId, userId },
    update: {},
  });
}

export async function leaveCommunity(communityId: string, userId: string): Promise<boolean> {
  const result = await prisma.communityMembership.deleteMany({ where: { communityId, userId } });
  return result.count === 1;
}

export async function listJoinedCommunities(userId: string) {
  const memberships = await prisma.communityMembership.findMany({
    where: { userId },
    include: { community: true },
    orderBy: { joinedAt: "desc" },
  });
  return memberships.map(({ community }) => community);
}
