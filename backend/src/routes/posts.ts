// Maps /api/posts URLs to controller functions. Only says which URL + HTTP method runs which function.
// Belongs here: e.g. "GET /api/posts/:postId runs getPost from postControllers". No logic or database calls.

import { Router } from "express";
import * as posts from "../controller/postController.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

router.get("/:postId", posts.getPost);
router.post("/", requireAuth, posts.createPost);
router.patch("/:postId", requireAuth, posts.updatePost);
router.delete("/:postId", requireAuth, posts.deletePost);
router.put("/:postId/like", requireAuth, posts.likePost);
router.delete("/:postId/like", requireAuth, posts.unlikePost);

router.get("/:postId/comments", posts.listComments);
router.post("/:postId/comments", requireAuth, posts.createComment);

export default router;
