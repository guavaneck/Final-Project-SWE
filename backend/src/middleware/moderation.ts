import type { NextFunction, Request, Response } from "express";
import { getCommunityById, isModerator } from "../db/index.js";
import { isUuid } from "../services/postService.js";
import { authenticatedUser } from "./auth.js";

// For routes with :communityId. Runs after requireAuth: sends a 404 if there's no such community,
// or a 403 if the user doesn't moderate it.
export async function requireModerator(req: Request<{ communityId: string }>, res: Response, next: NextFunction) {
  const { communityId } = req.params;
  if (!isUuid(communityId) || !(await getCommunityById(communityId))) {
    return res.status(404).json({ error: "Community not found" });
  }
  if (!(await isModerator(communityId, authenticatedUser(req).id))) {
    return res.status(403).json({ error: "You are not a moderator of this community" });
  }
  next();
}
