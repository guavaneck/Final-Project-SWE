// Handles the HTTP side of post requests: reads the request, checks input, calls postService, and sends the response.
// Belongs here: e.g. getPost reads postId from the URL, calls the service, and returns 404 if the post doesn't exist or the post as JSON if it does.

// controller/postController.ts
import type { Request, Response } from "express";
import * as db from "../db/index.js";
import * as postService from "../services/postService.js";

const POST_TYPES = ["text", "link", "media"] as const;

// TEMPORARY: there is no login yet, so the caller says who they are with an X-User-Id header.
// Replace this with a real session check once auth exists.
function currentUserId(req: Request, res: Response): string | undefined {
  const userId = req.header("x-user-id");
  if (!userId) {
    res.status(401).json({ error: "X-User-Id header is required" });
    return undefined;
  }
  return userId;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

// :postId in URLs is the post's short public ID. Sends a 404 and returns null if there's no such post.
async function findPost(req: Request<{ postId: string }>, res: Response) {
  const publicId = db.normalizePublicId(req.params.postId);
  const post = publicId ? await db.getPostByPublicId(publicId) : null;
  if (!post) {
    res.status(404).json({ error: "Post not found" });
  }
  return post;
}

//GET /api/posts/:postId
export async function getPost(req: Request<{ postId: string }>, res: Response) {
  const post = await findPost(req, res);
  if (!post) return;
  res.json(post);
}

//POST /api/posts
export async function createPost(req: Request, res: Response) {
  const authorId = currentUserId(req, res);
  if (!authorId) return;

  const { communityId, postType, title, body, externalUrl } = req.body ?? {};
  if (typeof communityId !== "string" || communityId === "") {
    return res.status(400).json({ error: "communityId is required" });
  }
  if (!POST_TYPES.includes(postType)) {
    return res.status(400).json({ error: `postType must be one of: ${POST_TYPES.join(", ")}` });
  }
  if (typeof title !== "string" || title.trim() === "") {
    return res.status(400).json({ error: "title is required" });
  }

  const post = await db.createPost({
    authorId,
    communityId,
    postType,
    title,
    body: optionalString(body),
    externalUrl: optionalString(externalUrl),
  });
  res.status(201).json(post);
}

//PATCH /api/posts/:postId
export async function updatePost(req: Request<{ postId: string }>, res: Response) {
  const authorId = currentUserId(req, res);
  if (!authorId) return;

  const { title, body, externalUrl } = req.body ?? {};
  if (typeof title !== "string" || title.trim() === "") {
    return res.status(400).json({ error: "title is required" });
  }

  const existing = await findPost(req, res);
  if (!existing) return;

  const post = await db.updatePost(existing.id, authorId, {
    title,
    body: optionalString(body),
    externalUrl: optionalString(externalUrl),
  });
  if (!post) {
    return res.status(403).json({ error: "You are not the author of this post" });
  }
  res.json(post);
}

//DELETE /api/posts/:postId
export async function deletePost(req: Request<{ postId: string }>, res: Response) {
  const authorId = currentUserId(req, res);
  if (!authorId) return;

  const post = await findPost(req, res);
  if (!post) return;

  const deleted = await db.deletePost(post.id, authorId);
  if (!deleted) {
    return res.status(403).json({ error: "You are not the author of this post" });
  }
  res.status(204).end();
}

//GET /api/posts/:postId/comments
export async function listComments(req: Request<{ postId: string }>, res: Response) {
  const post = await findPost(req, res);
  if (!post) return;
  res.json(await postService.listCommentThreads(post.id));
}

//POST /api/posts/:postId/comments
export async function createComment(req: Request<{ postId: string }>, res: Response) {
  const authorId = currentUserId(req, res);
  if (!authorId) return;

  const { body, parentId } = req.body ?? {};
  if (typeof body !== "string" || body.trim() === "") {
    return res.status(400).json({ error: "body is required" });
  }

  const post = await findPost(req, res);
  if (!post) return;

  const comment = await db.createComment(post.id, authorId, body, optionalString(parentId));
  if (!comment) {
    return res.status(404).json({ error: "Parent comment not found on this post" });
  }
  res.status(201).json(comment);
}
