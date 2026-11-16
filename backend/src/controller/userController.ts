import type { Request, Response } from "express";
import * as db from "../db/index.js";
import { isUuid } from "../services/postService.js";
import { authenticatedUser } from "../middleware/auth.js";

//GET /api/users/me/following
export async function listFollowing(req: Request, res: Response) {
  res.json(await db.listFollowingIds(authenticatedUser(req).id));
}

//PUT /api/users/:userId/follow
export async function follow(req: Request<{ userId: string }>, res: Response) {
  const me = authenticatedUser(req).id;
  const { userId } = req.params;
  if (!isUuid(userId)) return res.status(400).json({ error: "userId must be a user ID" });
  if (userId === me) return res.status(400).json({ error: "You cannot follow yourself" });
  if (!(await db.getUserById(userId))) return res.status(404).json({ error: "User not found" });

  await db.followUser(me, userId);
  res.status(204).end();
}

//DELETE /api/users/:userId/follow
export async function unfollow(req: Request<{ userId: string }>, res: Response) {
  const { userId } = req.params;
  if (!isUuid(userId)) return res.status(400).json({ error: "userId must be a user ID" });

  await db.unfollowUser(authenticatedUser(req).id, userId);
  res.status(204).end();
}
