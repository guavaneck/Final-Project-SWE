import { randomUUID } from "node:crypto";
import { prisma } from "./client.js";

const publicUser = {
  id: true,
  username: true,
  email: true,
  displayName: true,
  bio: true,
  accountStatus: true,
  avatarMediaId: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
} as const;

export interface CreateUserInput {
  username: string;
  email: string;
  passwordHash: string;
  displayName: string;
  bio?: string;
}

export function createUser(input: CreateUserInput) {
  return prisma.user.create({
    data: { id: randomUUID(), ...input },
    select: publicUser,
  });
}

export function getUserById(id: string) {
  return prisma.user.findFirst({
    where: { id, deletedAt: null },
    select: publicUser,
  });
}

export function getPasswordHashByEmail(email: string) {
  return prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" }, accountStatus: "active" },
    select: { id: true, passwordHash: true },
  });
}

export function getUserCredentials(login: string) {
  return prisma.user.findFirst({
    where: {
      accountStatus: "active",
      deletedAt: null,
      OR: [
        { email: { equals: login, mode: "insensitive" } },
        { username: { equals: login, mode: "insensitive" } },
      ],
    },
    select: { id: true, username: true, email: true, displayName: true, passwordHash: true },
  });
}

export async function deleteUser(id: string): Promise<boolean> {
  const result = await prisma.user.updateMany({
    where: { id, deletedAt: null },
    data: { accountStatus: "deleted", deletedAt: new Date(), updatedAt: new Date() },
  });
  return result.count === 1;
}

export async function createSession(
  userId: string,
  tokenHash: string,
  expiresAt: Date,
  deviceName?: string,
): Promise<string> {
  const session = await prisma.session.create({
    data: { id: randomUUID(), userId, tokenHash, expiresAt, deviceName },
    select: { id: true },
  });
  return session.id;
}

export async function revokeSession(id: string, userId: string): Promise<boolean> {
  const result = await prisma.session.updateMany({
    where: { id, userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count === 1;
}


export function getActiveSessionByTokenHash(tokenHash: string) {
  return prisma.session.findFirst({
    where: { tokenHash, revokedAt: null, expiresAt: { gt: new Date() } },
    select: {
      id: true,
      expiresAt: true,
      user: {
        select: {
          id: true,
          username: true,
          email: true,
          displayName: true,
          accountStatus: true,
          deletedAt: true,
        },
      },
    },
  });
}

export async function revokeSessionByTokenHash(tokenHash: string): Promise<boolean> {
  const result = await prisma.session.updateMany({
    where: { tokenHash, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count === 1;
}
