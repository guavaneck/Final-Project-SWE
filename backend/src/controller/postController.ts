// Handles the HTTP side of post requests: reads the request, checks input, calls postService, and sends the response.
// Belongs here: e.g. getPost reads postId from the URL, calls the service, and returns 404 if the post doesn't exist or the post as JSON if it does.

// controller/postController.ts
import type { Request, Response } from "express";
import * as db from "../db/index.js";
import * as postService from "../services/postService.js";
import { authenticatedUser } from "../middleware/auth.js";

const POST_TYPES = ["text", "link", "media"] as const;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

// For PATCH fields: undefined leaves the field alone, and null or a blank string clears it.
function patchField(value: string | null | undefined): string | null | undefined {
  return value === undefined ? undefined : (optionalString(value) ?? null);
}

function isNullableString(value: unknown): value is string | null | undefined {
  return value === undefined || value === null || typeof value === "string";
}

// Reads ?limit= and ?cursor= for feeds. Sends a 400 and returns null if either is invalid.
function readPage(req: Request, res: Response) {
  const { limit: rawLimit, cursor: rawCursor } = req.query;

  const limit = rawLimit === undefined ? DEFAULT_PAGE_SIZE : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) {
    res.status(400).json({ error: `limit must be a whole number from 1 to ${MAX_PAGE_SIZE}` });
    return null;
  }

  if (rawCursor === undefined) return { limit, cursor: undefined };
  const cursor = typeof rawCursor === "string" ? postService.decodeCursor(rawCursor) : null;
  if (!cursor) {
    res.status(400).json({ error: "cursor is invalid" });
    return null;
  }
  return { limit, cursor };
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
  const authorId = authenticatedUser(req).id;

  const { communityId, postType, title, body, externalUrl } = req.body ?? {};
  if (!postService.isUuid(communityId)) {
    return res.status(400).json({ error: "communityId is required" });
  }
  if (!POST_TYPES.includes(postType)) {
    return res.status(400).json({ error: `postType must be one of: ${POST_TYPES.join(", ")}` });
  }
  if (typeof title !== "string") {
    return res.status(400).json({ error: "title is required" });
  }

  const content = {
    title: title.trim(),
    body: optionalString(body) ?? null,
    externalUrl: optionalString(externalUrl) ?? null,
  };
  const error = postService.validatePostContent(postType, content);
  if (error) {
    return res.status(400).json({ error });
  }
  if (!(await db.getCommunityById(communityId))) {
    return res.status(404).json({ error: "Community not found" });
  }

  const post = await db.createPost({
    authorId,
    communityId,
    postType,
    title: content.title,
    body: content.body ?? undefined,
    externalUrl: content.externalUrl ?? undefined,
  });
  res.status(201).json(post);
}

//PATCH /api/posts/:postId
// Every field is optional; send null or "" to clear body or externalUrl.
export async function updatePost(req: Request<{ postId: string }>, res: Response) {
  const authorId = authenticatedUser(req).id;

  const { title, body, externalUrl } = req.body ?? {};
  if (title !== undefined && typeof title !== "string") {
    return res.status(400).json({ error: "title must be a string" });
  }
  if (!isNullableString(body) || !isNullableString(externalUrl)) {
    return res.status(400).json({ error: "body and externalUrl must be strings or null" });
  }
  if (title === undefined && body === undefined && externalUrl === undefined) {
    return res.status(400).json({ error: "Send at least one of title, body, or externalUrl" });
  }

  const existing = await findPost(req, res);
  if (!existing) return;
  if (existing.authorId !== authorId) {
    return res.status(403).json({ error: "You are not the author of this post" });
  }

  const changes = { title: title?.trim(), body: patchField(body), externalUrl: patchField(externalUrl) };
  const error = postService.validatePostContent(existing.postType, {
    title: changes.title ?? existing.title,
    body: changes.body === undefined ? existing.body : changes.body,
    externalUrl: changes.externalUrl === undefined ? existing.externalUrl : changes.externalUrl,
  });
  if (error) {
    return res.status(400).json({ error });
  }

  const post = await db.updatePost(existing.id, authorId, changes);
  if (!post) {
    return res.status(403).json({ error: "You are not the author of this post" });
  }
  res.json(post);
}

//DELETE /api/posts/:postId
export async function deletePost(req: Request<{ postId: string }>, res: Response) {
  const authorId = authenticatedUser(req).id;

  const post = await findPost(req, res);
  if (!post) return;

  const deleted = await db.deletePost(post.id, authorId);
  if (!deleted) {
    return res.status(403).json({ error: "You are not the author of this post" });
  }
  res.status(204).end();
}

//GET /api/posts/feed
// Posts by the user, by people they follow, and in communities they've joined. Newest first.
export async function homeFeed(req: Request, res: Response) {
  const userId = authenticatedUser(req).id;
  const page = readPage(req, res);
  if (!page) return;

  const posts = await db.listHomeFeed(userId, page.limit, page.cursor);
  res.json(postService.postPage(posts, page.limit));
}

//GET /api/communities/:communityId/posts
export async function communityFeed(req: Request<{ communityId: string }>, res: Response) {
  const { communityId } = req.params;
  if (!postService.isUuid(communityId) || !(await db.getCommunityById(communityId))) {
    return res.status(404).json({ error: "Community not found" });
  }
  const page = readPage(req, res);
  if (!page) return;

  const posts = await db.listCommunityPosts(communityId, page.limit, page.cursor);
  res.json(postService.postPage(posts, page.limit));
}

// PUT /api/posts/:postId/like
export async function likePost(req: Request<{ postId: string }>, res: Response) {
  const userId = authenticatedUser(req).id;
  const post = await findPost(req, res);
  if (!post) return;

  await db.setPostLiked(post.id, userId, true);
  res.json(await db.getPostLikeSummary(post.id, userId));
}

// DELETE /api/posts/:postId/like
export async function unlikePost(req: Request<{ postId: string }>, res: Response) {
  const userId = authenticatedUser(req).id;
  const post = await findPost(req, res);
  if (!post) return;

  await db.setPostLiked(post.id, userId, false);
  res.json(await db.getPostLikeSummary(post.id, userId));
}

//GET /api/posts/:postId/comments
export async function listComments(req: Request<{ postId: string }>, res: Response) {
  const post = await findPost(req, res);
  if (!post) return;
  res.json(await postService.listCommentThreads(post.id));
}

//POST /api/posts/:postId/comments
export async function createComment(req: Request<{ postId: string }>, res: Response) {
  const authorId = authenticatedUser(req).id;

  const { body, parentId } = req.body ?? {};
  if (typeof body !== "string" || body.trim() === "") {
    return res.status(400).json({ error: "body is required" });
  }
  if (parentId !== undefined && parentId !== null && !postService.isUuid(parentId)) {
    return res.status(400).json({ error: "parentId must be a comment ID" });
  }

  const post = await findPost(req, res);
  if (!post) return;

  const comment = await db.createComment(post.id, authorId, body, parentId ?? undefined);
  if (!comment) {
    return res.status(404).json({ error: "Parent comment not found on this post" });
  }
  res.status(201).json(comment);
}

async function findComment(
  req: Request<{ postId: string; commentId: string }>,
  res: Response,
) {
  const post = await findPost(req, res);
  if (!post) return null;
  const { commentId } = req.params;
  const comment = postService.isUuid(commentId) ? await db.getCommentOnPost(commentId, post.id) : null;
  if (!comment) res.status(404).json({ error: "Comment not found on this post" });
  return comment;
}

// PATCH /api/posts/:postId/comments/:commentId
export async function updateComment(
  req: Request<{ postId: string; commentId: string }>,
  res: Response,
) {
  const authorId = authenticatedUser(req).id;

  const { body } = req.body ?? {};
  if (typeof body !== "string" || body.trim() === "") {
    return res.status(400).json({ error: "body is required" });
  }

  const comment = await findComment(req, res);
  if (!comment) return;

  const updated = await db.updateComment(comment.id, authorId, body);
  if (!updated) {
    return res.status(403).json({ error: "You are not the author of this comment" });
  }
  res.json(updated);
}

// DELETE /api/posts/:postId/comments/:commentId
// Replies stay in the thread under the deleted comment, which keeps its place with a null body.
export async function deleteComment(
  req: Request<{ postId: string; commentId: string }>,
  res: Response,
) {
  const authorId = authenticatedUser(req).id;
  const comment = await findComment(req, res);
  if (!comment) return;

  const deleted = await db.deleteComment(comment.id, authorId);
  if (!deleted) {
    return res.status(403).json({ error: "You are not the author of this comment" });
  }
  res.status(204).end();
}

// PUT /api/posts/:postId/comments/:commentId/like
export async function likeComment(
  req: Request<{ postId: string; commentId: string }>,
  res: Response,
) {
  const userId = authenticatedUser(req).id;
  const comment = await findComment(req, res);
  if (!comment) return;

  await db.setCommentLiked(comment.id, userId, true);
  res.json(await db.getCommentLikeSummary(comment.id, userId));
}

// DELETE /api/posts/:postId/comments/:commentId/like
export async function unlikeComment(
  req: Request<{ postId: string; commentId: string }>,
  res: Response,
) {
  const userId = authenticatedUser(req).id;
  const comment = await findComment(req, res);
  if (!comment) return;

  await db.setCommentLiked(comment.id, userId, false);
  res.json(await db.getCommentLikeSummary(comment.id, userId));
}
