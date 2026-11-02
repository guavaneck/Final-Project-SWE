// Maps /api/communities URLs to controller functions. Only says which URL + HTTP method runs which function.
// Belongs here: e.g. "GET /api/communities/:communityId/posts runs communityFeed from postController". No logic or database calls.

import { Router } from "express";
import * as posts from "../controller/postController.js";

const router = Router();

router.get("/:communityId/posts", posts.communityFeed);

export default router;
