// Maps /api/communities URLs to controller functions. Only says which URL + HTTP method runs which function.
// Belongs here: e.g. "GET /api/communities/:communityId/posts runs communityFeed from postController". No logic or database calls.

import { Router } from "express";
import * as posts from "../controller/postController.js";
import * as communities from "../controller/communityController.js";
import { optionalAuth } from "../middleware/auth.js";

const router = Router();

router.get("/", communities.listCommunities);
router.get("/:communityId/posts", optionalAuth, posts.communityFeed);

export default router;
