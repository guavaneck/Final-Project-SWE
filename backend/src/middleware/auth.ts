import type { NextFunction, Request, Response } from "express";
import { getActiveSessionByTokenHash } from "../db/index.js";
import { hashSessionToken } from "../auth/session.js";

function bearerToken(req: Request): string | undefined {
  const authorization = req.header("authorization");
  if (!authorization) return undefined;
  const match = /^Bearer ([A-Za-z0-9_-]+)$/.exec(authorization);
  return match?.[1];
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = bearerToken(req);
  if (!token) return res.status(401).json({ error: "A Bearer token is required" });

  const session = await getActiveSessionByTokenHash(hashSessionToken(token));
  if (!session || session.user.accountStatus !== "active" || session.user.deletedAt) {
    return res.status(401).json({ error: "Invalid or expired session" });
  }

  req.auth = {
    sessionId: session.id,
    user: {
      id: session.user.id,
      username: session.user.username,
      email: session.user.email,
      displayName: session.user.displayName,
    },
  };
  next();
}

export function authenticatedUser(req: Request) {
  if (!req.auth) throw new Error("requireAuth must run before this handler");
  return req.auth.user;
}
