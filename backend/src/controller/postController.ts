// Handles the HTTP side of post requests: reads the request, checks input, calls postService, and sends the response.
// Belongs here: e.g. getPost reads postId from the URL, calls the service, and returns 404 if the post doesn't exist or the post as JSON if it does.

// controller/postController.ts
import type { Request, Response } from "express";
import * as db from "../db/index.js";

//GET /api/posts/:postId
export async function getPost(req: Request<{postId: string}>, res: Response) {
  const post = await db.getPostById(req.params.postId);
    if (!post) {
        return res.status(404).json({ error: "Post not found" });
    }
    res.json(post);
}

