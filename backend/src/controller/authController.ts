import type { Request, Response } from "express";
import { Prisma } from "../generated/prisma/client.js";
import * as db from "../db/index.js";
import { hashPassword, verifyPassword } from "../auth/password.js";
import { createSessionToken, hashSessionToken, SESSION_LIFETIME_MS } from "../auth/session.js";
import { authenticatedUser } from "../middleware/auth.js";

const USERNAME = /^[a-z0-9_]{3,32}$/;

function validPassword(value: unknown): value is string {
  return typeof value === "string" && value.length >= 8 && value.length <= 128;
}

function publicUser(user: { id: string; username: string; email: string; displayName: string }) {
  return { id: user.id, username: user.username, email: user.email, displayName: user.displayName };
}

async function startSession(userId: string, deviceName?: string) {
  const token = createSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_LIFETIME_MS);
  await db.createSession(userId, hashSessionToken(token), expiresAt, deviceName);
  return { token, expiresAt };
}

export async function register(req: Request, res: Response) {
  const raw = req.body ?? {};
  const username = typeof raw.username === "string" ? raw.username.trim().toLowerCase() : "";
  const email = typeof raw.email === "string" ? raw.email.trim().toLowerCase() : "";
  const displayName = typeof raw.displayName === "string" ? raw.displayName.trim() : "";
  if (!USERNAME.test(username)) {
    return res.status(400).json({ error: "username must be 3-32 lowercase letters, numbers, or underscores" });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320) {
    return res.status(400).json({ error: "A valid email is required" });
  }
  if (!displayName || displayName.length > 80) {
    return res.status(400).json({ error: "displayName must be 1-80 characters" });
  }
  if (!validPassword(raw.password)) {
    return res.status(400).json({ error: "password must be 8-128 characters" });
  }

  try {
    const user = await db.createUser({
      username,
      email,
      displayName,
      passwordHash: await hashPassword(raw.password),
    });
    const session = await startSession(user.id, typeof raw.deviceName === "string" ? raw.deviceName.slice(0, 120) : undefined);
    return res.status(201).json({ user: publicUser(user), ...session });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return res.status(409).json({ error: "Username or email is already registered" });
    }
    throw error;
  }
}

export async function login(req: Request, res: Response) {
  const { login: rawLogin, password, deviceName } = req.body ?? {};
  const login = typeof rawLogin === "string" ? rawLogin.trim() : "";
  if (!login || !validPassword(password)) {
    return res.status(400).json({ error: "login and password are required" });
  }

  const user = await db.getUserCredentials(login);
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    return res.status(401).json({ error: "Invalid login or password" });
  }
  const session = await startSession(user.id, typeof deviceName === "string" ? deviceName.slice(0, 120) : undefined);
  return res.json({ user: publicUser(user), ...session });
}

export function me(req: Request, res: Response) {
  res.json({ user: authenticatedUser(req) });
}

export async function logout(req: Request, res: Response) {
  const token = req.header("authorization")?.slice("Bearer ".length);
  if (token) await db.revokeSessionByTokenHash(hashSessionToken(token));
  res.status(204).end();
}
