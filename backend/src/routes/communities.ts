// Maps /api/communities URLs to controller functions. Only says which URL + HTTP method runs which function.
// Belongs here: e.g. "GET /api/communities/:communityId/posts runs communityFeed from postController". No logic or database calls.

import { Router } from "express";
import * as posts from "../controller/postController.js";
import * as communities from "../controller/communityController.js";
import { optionalAuth, requireAuth } from "../middleware/auth.js";
import { requireModerator } from "../middleware/moderation.js";

const router = Router();

router.get("/", communities.listCommunities);
router.post("/", requireAuth, communities.createCommunity);
router.get("/:communityId", optionalAuth, communities.getCommunity);
router.patch("/:communityId", requireAuth, requireModerator, communities.updateCommunity);
router.get("/:communityId/posts", optionalAuth, posts.communityFeed);

router.get("/:communityId/moderators", communities.listModerators);
router.put("/:communityId/moderators/:userId", requireAuth, requireModerator, communities.addModerator);
router.delete("/:communityId/moderators/:userId", requireAuth, requireModerator, communities.removeModerator);

router.get("/:communityId/bans", requireAuth, requireModerator, communities.listBans);
router.put("/:communityId/bans/:userId", requireAuth, requireModerator, communities.banUser);
router.delete("/:communityId/bans/:userId", requireAuth, requireModerator, communities.unbanUser);

export default router;
