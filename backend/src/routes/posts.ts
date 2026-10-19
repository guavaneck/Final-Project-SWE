// Maps /api/posts URLs to controller functions. Only says which URL + HTTP method runs which function.
// Belongs here: e.g. "GET /api/posts/:postId runs getPost from postControllers". No logic or database calls.

import { Router } from "express";
import * as posts from "../controller/postController.js";

const router = Router();

router.get("/:postId", posts.getPost);
router.post("/", posts.createPost);
router.patch("/:postId", posts.updatePost);
router.delete("/:postId", posts.deletePost);

router.get("/:postId/comments", posts.listComments);
router.post("/:postId/comments", posts.createComment);

export default router;