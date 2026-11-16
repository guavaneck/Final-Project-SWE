import type { Request, Response } from "express";
import { Prisma } from "../generated/prisma/client.js";
import * as db from "../db/index.js";
import { authenticatedUser } from "../middleware/auth.js";

const SLUG = /^[a-z0-9_]{3,32}$/;

//GET /api/communities
export async function listCommunities(_req: Request, res: Response) {
  res.json(await db.listPublicCommunities());
}

//POST /api/communities
export async function createCommunity(req: Request, res: Response) {
  const raw = req.body ?? {};
  const slug = typeof raw.slug === "string" ? raw.slug.trim().toLowerCase() : "";
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (raw.description !== undefined && raw.description !== null && typeof raw.description !== "string") {
    return res.status(400).json({ error: "Description must be a string" });
  }
  const description = typeof raw.description === "string" ? raw.description.trim() : "";

  if (!SLUG.test(slug)) {
    return res.status(400).json({ error: "Community name must be 3-32 lowercase letters, numbers, or underscores" });
  }
  if (!name || name.length > 100) {
    return res.status(400).json({ error: "Display name must be 1-100 characters" });
  }
  if (description.length > 750) {
    return res.status(400).json({ error: "Description must be at most 750 characters" });
  }

  try {
    const community = await db.createCommunity({
      creatorId: authenticatedUser(req).id,
      slug,
      name,
      description: description || undefined,
    });
    return res.status(201).json(community);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return res.status(409).json({ error: "That community name is already taken" });
    }
    throw error;
  }
}
