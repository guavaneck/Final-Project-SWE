// Handles the HTTP side of post requests: reads the request, checks input, calls postService, and sends the response.
// Belongs here: e.g. getPost reads postId from the URL, calls the service, and returns 404 if the post doesn't exist or the post as JSON if it does.

// controller/postController.ts
import type { Request, Response } from "express";
import * as db from "../db/index.js";
import * as postService from "../services/postService.js";
import * as mediaService from "../services/mediaService.js";
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

type PostList = Awaited<ReturnType<typeof db.listCommunityPosts>>;

// Adds the viewer's vote on each post and signed URLs for each post's media.
async function withDetails(posts: PostList, viewerId?: string) {
  return Promise.all((await postService.withViewerVotes(posts, viewerId)).map((post) => mediaService.withMediaUrls(post)));
}

// Sends one page of a feed. `extra` adds fields to the response, e.g. a community's pinned posts.
async function sendPage(res: Response, posts: PostList, limit: number, viewerId?: string, extra?: object) {
  const page = postService.postPage(await withDetails(posts, viewerId), limit);
  res.json({ ...extra, ...page });
}

// Sends a 403 and returns true if the user is banned from the community.
async function rejectBanned(res: Response, communityId: string, userId: string): Promise<boolean> {
  if (!(await db.isBanned(communityId, userId))) return false;
  res.status(403).json({ error: "You are banned from this community" });
  return true;
}

// The authorId to pass to db.deletePost or db.deleteComment: the user's own ID if they wrote it,
// null (no author check) if they moderate the community, or undefined if they can't delete it.
async function deleteAs(authorId: string, communityId: string, userId: string): Promise<string | null | undefined> {
  if (authorId === userId) return userId;
  return (await db.isModerator(communityId, userId)) ? null : undefined;
}

// Reads mediaIds for a new post. Sends a 400 and returns null if they're invalid.
function readMediaIds(req: Request, res: Response, postType: string): string[] | null {
  const { mediaIds } = req.body ?? {};
  if (postType !== "media") {
    if (mediaIds === undefined || (Array.isArray(mediaIds) && mediaIds.length === 0)) return [];
    res.status(400).json({ error: "Only media posts can have mediaIds" });
    return null;
  }
  const max = mediaService.MAX_MEDIA_PER_POST;
  if (!Array.isArray(mediaIds) || mediaIds.length < 1 || mediaIds.length > max) {
    res.status(400).json({ error: `Media posts need mediaIds: 1-${max} uploaded media IDs` });
    return null;
  }
  if (!mediaIds.every(postService.isUuid) || new Set(mediaIds).size !== mediaIds.length) {
    res.status(400).json({ error: "mediaIds must be distinct media IDs" });
    return null;
  }
  return mediaIds;
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
  const [withVote] = await postService.withViewerVotes([post], req.auth?.user.id);
  res.json(await mediaService.withMediaUrls(withVote!));
}

//POST /api/posts
// Media posts take mediaIds: uploads from POST /api/media that have been completed, in display order.
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
  const mediaIds = readMediaIds(req, res, postType);
  if (!mediaIds) return;
  if (!(await db.getCommunityById(communityId))) {
    return res.status(404).json({ error: "Community not found" });
  }
  if (await rejectBanned(res, communityId, authorId)) return;
  const mediaError = mediaIds.length ? await mediaService.checkAttachable(mediaIds, authorId) : null;
  if (mediaError) {
    return res.status(409).json({ error: mediaError });
  }

  try {
    const post = await db.createPost({
      authorId,
      communityId,
      postType,
      title: content.title,
      body: content.body ?? undefined,
      externalUrl: content.externalUrl ?? undefined,
      mediaIds,
    });
    res.status(201).json(await mediaService.withMediaUrls(post));
  } catch (err) {
    if (err instanceof db.MediaUnavailableError) {
      return res.status(409).json({ error: "Some of that media was just attached to another post" });
    }
    throw err;
  }
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
  if (await rejectBanned(res, existing.communityId, authorId)) return;

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
  res.json(await mediaService.withMediaUrls(post));
}

//DELETE /api/posts/:postId
// The author or a moderator of the post's community can delete it.
export async function deletePost(req: Request<{ postId: string }>, res: Response) {
  const userId = authenticatedUser(req).id;

  const post = await findPost(req, res);
  if (!post) return;

  const authorId = await deleteAs(post.authorId, post.communityId, userId);
  if (authorId === undefined || !(await db.deletePost(post.id, authorId))) {
    return res.status(403).json({ error: "You are not the author of this post or a moderator of its community" });
  }
  // The post's files go too: from storage and from the database.
  await mediaService.purgeMedia(post.media.map(({ media }) => media));
  res.status(204).end();
}

//GET /api/posts/feed
// Posts by the user, by people they follow, and in communities they've joined. Newest first.
export async function homeFeed(req: Request, res: Response) {
  const userId = authenticatedUser(req).id;
  const page = readPage(req, res);
  if (!page) return;

  await sendPage(res, await db.listHomeFeed(userId, page.limit, page.cursor), page.limit, userId);
}

//GET /api/communities/:communityId/posts
// The first page (no cursor) also has `pinned`: the community's pinned posts, which stay in `posts` too.
export async function communityFeed(req: Request<{ communityId: string }>, res: Response) {
  const { communityId } = req.params;
  if (!postService.isUuid(communityId) || !(await db.getCommunityById(communityId))) {
    return res.status(404).json({ error: "Community not found" });
  }
  const page = readPage(req, res);
  if (!page) return;

  const viewerId = req.auth?.user.id;
  const pinned = page.cursor ? undefined : { pinned: await withDetails(await db.listPinnedPosts(communityId), viewerId) };
  await sendPage(res, await db.listCommunityPosts(communityId, page.limit, page.cursor), page.limit, viewerId, pinned);
}

// Sends a 403 and returns false if the user doesn't moderate the post's community.
async function checkModerator(res: Response, communityId: string, userId: string): Promise<boolean> {
  if (await db.isModerator(communityId, userId)) return true;
  res.status(403).json({ error: "You are not a moderator of this community" });
  return false;
}

// PUT /api/posts/:postId/pin (moderators)
export async function pinPost(req: Request<{ postId: string }>, res: Response) {
  const post = await findPost(req, res);
  if (!post) return;
  if (!(await checkModerator(res, post.communityId, authenticatedUser(req).id))) return;

  if (!(await db.pinPost(post.id, post.communityId))) {
    return res.status(409).json({ error: `A community can have at most ${db.MAX_PINNED_POSTS} pinned posts` });
  }
  res.status(204).end();
}

// DELETE /api/posts/:postId/pin (moderators)
export async function unpinPost(req: Request<{ postId: string }>, res: Response) {
  const post = await findPost(req, res);
  if (!post) return;
  if (!(await checkModerator(res, post.communityId, authenticatedUser(req).id))) return;

  await db.unpinPost(post.id);
  res.status(204).end();
}

// PUT /api/posts/:postId/vote
export async function votePost(req: Request<{ postId: string }>, res: Response) {
  const userId = authenticatedUser(req).id;
  const { value } = req.body ?? {};
  if (!postService.isVote(value)) {
    return res.status(400).json({ error: "value must be 1 or -1" });
  }
  const post = await findPost(req, res);
  if (!post) return;

  await db.setPostVote(post.id, userId, value);
  res.json(await db.getPostVoteSummary(post.id, userId));
}

// DELETE /api/posts/:postId/vote
export async function unvotePost(req: Request<{ postId: string }>, res: Response) {
  const userId = authenticatedUser(req).id;
  const post = await findPost(req, res);
  if (!post) return;

  await db.setPostVote(post.id, userId, 0);
  res.json(await db.getPostVoteSummary(post.id, userId));
}

//GET /api/posts/:postId/comments
export async function listComments(req: Request<{ postId: string }>, res: Response) {
  const post = await findPost(req, res);
  if (!post) return;
  res.json(await postService.listCommentThreads(post.id, req.auth?.user.id));
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
  if (await rejectBanned(res, post.communityId, authorId)) return;

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
  if (!comment) {
    res.status(404).json({ error: "Comment not found on this post" });
    return null;
  }
  return { ...comment, communityId: post.communityId };
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
  if (await rejectBanned(res, comment.communityId, authorId)) return;

  const updated = await db.updateComment(comment.id, authorId, body);
  if (!updated) {
    return res.status(403).json({ error: "You are not the author of this comment" });
  }
  res.json(updated);
}

// DELETE /api/posts/:postId/comments/:commentId
// Replies stay in the thread under the deleted comment, which keeps its place with a null body.
// The author or a moderator of the post's community can delete it.
export async function deleteComment(
  req: Request<{ postId: string; commentId: string }>,
  res: Response,
) {
  const userId = authenticatedUser(req).id;
  const comment = await findComment(req, res);
  if (!comment) return;

  const authorId = await deleteAs(comment.authorId, comment.communityId, userId);
  if (authorId === undefined || !(await db.deleteComment(comment.id, authorId))) {
    return res.status(403).json({ error: "You are not the author of this comment or a moderator of its community" });
  }
  res.status(204).end();
}

// PUT /api/posts/:postId/comments/:commentId/vote
export async function voteComment(
  req: Request<{ postId: string; commentId: string }>,
  res: Response,
) {
  const userId = authenticatedUser(req).id;
  const { value } = req.body ?? {};
  if (!postService.isVote(value)) {
    return res.status(400).json({ error: "value must be 1 or -1" });
  }
  const comment = await findComment(req, res);
  if (!comment) return;

  await db.setCommentVote(comment.id, userId, value);
  res.json(await db.getCommentVoteSummary(comment.id, userId));
}

// DELETE /api/posts/:postId/comments/:commentId/vote
export async function unvoteComment(
  req: Request<{ postId: string; commentId: string }>,
  res: Response,
) {
  const userId = authenticatedUser(req).id;
  const comment = await findComment(req, res);
  if (!comment) return;

  await db.setCommentVote(comment.id, userId, 0);
  res.json(await db.getCommentVoteSummary(comment.id, userId));
}
