import type { Request, Response } from "express";
import { Prisma } from "../generated/prisma/client.js";
import * as db from "../db/index.js";
import { authenticatedUser } from "../middleware/auth.js";
import { isUuid } from "../services/postService.js";

const SLUG = /^[a-z0-9_]{3,32}$/;
const VISIBILITIES = ["public", "private"] as const;
const BAN_REASON_MAX_LENGTH = 500;

function nameError(name: string): string | null {
  return !name || name.length > 100 ? "Display name must be 1-100 characters" : null;
}

function descriptionError(description: string): string | null {
  return description.length > 750 ? "Description must be at most 750 characters" : null;
}

// For routes with :userId. Sends a 400 or 404 and returns null if there's no such user.
async function findUser(req: Request<{ communityId: string; userId: string }>, res: Response) {
  const { userId } = req.params;
  if (!isUuid(userId)) {
    res.status(400).json({ error: "userId must be a user ID" });
    return null;
  }
  const user = await db.getUserById(userId);
  if (!user) res.status(404).json({ error: "User not found" });
  return user;
}

//GET /api/communities
export async function listCommunities(_req: Request, res: Response) {
  res.json(await db.listPublicCommunities());
}

//GET /api/communities/:communityId
// Includes the moderators, and whether the viewer (if logged in) moderates or is banned from the community.
export async function getCommunity(req: Request<{ communityId: string }>, res: Response) {
  const { communityId } = req.params;
  const community = isUuid(communityId) ? await db.getCommunityById(communityId) : null;
  if (!community) {
    return res.status(404).json({ error: "Community not found" });
  }
  const viewerId = req.auth?.user.id;
  const [moderators, isModerator, isBanned] = await Promise.all([
    db.listModerators(communityId),
    viewerId ? db.isModerator(communityId, viewerId) : false,
    viewerId ? db.isBanned(communityId, viewerId) : false,
  ]);
  res.json({ ...community, moderators, viewer: { isModerator, isBanned } });
}

//POST /api/communities
// The creator becomes the community's first moderator.
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
  const error = nameError(name) ?? descriptionError(description);
  if (error) {
    return res.status(400).json({ error });
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

//PATCH /api/communities/:communityId (moderators)
// Every field is optional; send null or "" to clear the description. The slug can't change.
export async function updateCommunity(req: Request<{ communityId: string }>, res: Response) {
  const { name, description, visibility } = req.body ?? {};
  if (name !== undefined && typeof name !== "string") {
    return res.status(400).json({ error: "Display name must be a string" });
  }
  if (description !== undefined && description !== null && typeof description !== "string") {
    return res.status(400).json({ error: "Description must be a string" });
  }
  if (visibility !== undefined && !VISIBILITIES.includes(visibility)) {
    return res.status(400).json({ error: `visibility must be one of: ${VISIBILITIES.join(", ")}` });
  }
  if (name === undefined && description === undefined && visibility === undefined) {
    return res.status(400).json({ error: "Send at least one of name, description, or visibility" });
  }

  const changes = {
    name: name?.trim(),
    description: description === undefined ? undefined : description?.trim() || null,
    visibility,
  };
  const error = (changes.name !== undefined ? nameError(changes.name) : null) ?? descriptionError(changes.description ?? "");
  if (error) {
    return res.status(400).json({ error });
  }
  res.json(await db.updateCommunity(req.params.communityId, changes));
}

//GET /api/communities/:communityId/moderators
export async function listModerators(req: Request<{ communityId: string }>, res: Response) {
  const { communityId } = req.params;
  if (!isUuid(communityId) || !(await db.getCommunityById(communityId))) {
    return res.status(404).json({ error: "Community not found" });
  }
  res.json(await db.listModerators(communityId));
}

//PUT /api/communities/:communityId/moderators/:userId (moderators)
export async function addModerator(req: Request<{ communityId: string; userId: string }>, res: Response) {
  const user = await findUser(req, res);
  if (!user) return;
  const { communityId } = req.params;
  if (await db.isBanned(communityId, user.id)) {
    return res.status(409).json({ error: "That user is banned from this community; unban them first" });
  }
  await db.addModerator(communityId, user.id, authenticatedUser(req).id);
  res.status(204).end();
}

//DELETE /api/communities/:communityId/moderators/:userId (moderators)
// Moderators can remove themselves, but not the community's last moderator.
export async function removeModerator(req: Request<{ communityId: string; userId: string }>, res: Response) {
  const { communityId, userId } = req.params;
  if (!isUuid(userId)) {
    return res.status(400).json({ error: "userId must be a user ID" });
  }
  const result = await db.removeModerator(communityId, userId);
  if (result === "missing") {
    return res.status(404).json({ error: "That user is not a moderator of this community" });
  }
  if (result === "last") {
    return res.status(409).json({ error: "A community needs at least one moderator" });
  }
  res.status(204).end();
}

//GET /api/communities/:communityId/bans (moderators)
export async function listBans(req: Request<{ communityId: string }>, res: Response) {
  res.json(await db.listBans(req.params.communityId));
}

//PUT /api/communities/:communityId/bans/:userId (moderators)
// Takes an optional reason. Banning also removes the user from the community's members.
export async function banUser(req: Request<{ communityId: string; userId: string }>, res: Response) {
  const { reason } = req.body ?? {};
  if (reason !== undefined && reason !== null && typeof reason !== "string") {
    return res.status(400).json({ error: "reason must be a string" });
  }
  const trimmedReason = typeof reason === "string" ? reason.trim() : "";
  if (trimmedReason.length > BAN_REASON_MAX_LENGTH) {
    return res.status(400).json({ error: `reason must be at most ${BAN_REASON_MAX_LENGTH} characters` });
  }

  const user = await findUser(req, res);
  if (!user) return;
  const { communityId } = req.params;
  if (await db.isModerator(communityId, user.id)) {
    return res.status(409).json({ error: "Moderators can't be banned; remove them as a moderator first" });
  }
  await db.banUser(communityId, user.id, authenticatedUser(req).id, trimmedReason || undefined);
  res.status(204).end();
}

//DELETE /api/communities/:communityId/bans/:userId (moderators)
export async function unbanUser(req: Request<{ communityId: string; userId: string }>, res: Response) {
  const { communityId, userId } = req.params;
  if (!isUuid(userId)) {
    return res.status(400).json({ error: "userId must be a user ID" });
  }
  if (!(await db.unbanUser(communityId, userId))) {
    return res.status(404).json({ error: "That user is not banned from this community" });
  }
  res.status(204).end();
}
