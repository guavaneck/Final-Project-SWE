// Business logic and database access for posts. Knows nothing about HTTP (no req/res), so it's easy to test and reuse.
// Belongs here: e.g. createPost saves a new post with score 0 and commentCount 0, and votePost updates a post's score.

import * as db from "../db/index.js";

export const TITLE_MAX_LENGTH = 300;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Prisma throws on a malformed uuid instead of finding nothing, so check IDs from clients first.
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

export interface PostContent {
  title: string;
  body: string | null;
  externalUrl: string | null;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

// Checks a post's content against the rules for its type, the same ones the posts table enforces.
// Returns an error message, or null if the content is valid.
export function validatePostContent(postType: db.PostType, content: PostContent): string | null {
  const title = content.title.trim();
  if (title === "" || title.length > TITLE_MAX_LENGTH) {
    return `title must be 1-${TITLE_MAX_LENGTH} characters`;
  }
  if (content.externalUrl !== null && !isHttpUrl(content.externalUrl)) {
    return "externalUrl must be an http or https URL";
  }
  if (postType === "text") {
    if (content.body === null) return "Text posts require a body";
    if (content.externalUrl !== null) return "Text posts can't have an externalUrl";
  }
  if (postType === "link" && content.externalUrl === null) {
    return "Link posts require an externalUrl";
  }
  return null;
}

// Feed cursors are opaque to clients: the createdAt and id of the last post on the previous page.
export function encodeCursor(post: db.PageCursor): string {
  return Buffer.from(JSON.stringify([post.createdAt.toISOString(), post.id])).toString("base64url");
}

export function decodeCursor(cursor: string): db.PageCursor | null {
  try {
    const [createdAt, id] = JSON.parse(Buffer.from(cursor, "base64url").toString());
    const date = new Date(createdAt);
    if (!isUuid(id) || Number.isNaN(date.getTime())) return null;
    return { createdAt: date, id };
  } catch {
    return null;
  }
}

// Wraps one page of posts for the response. A full page means there may be more, so it gets a nextCursor.
export function postPage<T extends db.PageCursor>(posts: T[], limit: number) {
  const last = posts.at(-1);
  return { posts, nextCursor: posts.length === limit && last ? encodeCursor(last) : null };
}

type Comment = Awaited<ReturnType<typeof db.listComments>>[number];
export type CommentThread = Comment & { replies: CommentThread[] };

// Returns a post's comments as a tree: top-level comments, each with its replies nested under `replies`.
// Siblings stay oldest first, the order listComments returns them in.
export async function listCommentThreads(postId: string): Promise<CommentThread[]> {
  const comments = await db.listComments(postId);
  const byId = new Map<string, CommentThread>();
  for (const comment of comments) {
    byId.set(comment.id, { ...comment, replies: [] });
  }

  const roots: CommentThread[] = [];
  for (const thread of byId.values()) {
    const parent = thread.parentId ? byId.get(thread.parentId) : undefined;
    (parent ? parent.replies : roots).push(thread);
  }
  return roots;
}
