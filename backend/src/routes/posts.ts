// Maps /api/posts URLs to controller functions. Only says which URL + HTTP method runs which function.
// Belongs here: e.g. "GET /api/posts/:postId runs getPost from postControllers". No logic or database calls.

import { Router } from "express";
import * as posts from "../controller/postController.js";
import { optionalAuth, requireAuth } from "../middleware/auth.js";

const router = Router();

// Before /:postId, which would otherwise match "feed".
router.get("/feed", requireAuth, posts.homeFeed);

router.get("/:postId", optionalAuth, posts.getPost);
router.post("/", requireAuth, posts.createPost);
router.patch("/:postId", requireAuth, posts.updatePost);
router.delete("/:postId", requireAuth, posts.deletePost);
router.put("/:postId/vote", requireAuth, posts.votePost);
router.delete("/:postId/vote", requireAuth, posts.unvotePost);

router.get("/:postId/comments", optionalAuth, posts.listComments);
router.post("/:postId/comments", requireAuth, posts.createComment);
router.patch("/:postId/comments/:commentId", requireAuth, posts.updateComment);
router.delete("/:postId/comments/:commentId", requireAuth, posts.deleteComment);
router.put("/:postId/comments/:commentId/vote", requireAuth, posts.voteComment);
router.delete("/:postId/comments/:commentId/vote", requireAuth, posts.unvoteComment);

export default router;
