// Business logic and database access for posts. Knows nothing about HTTP (no req/res), so it's easy to test and reuse.
// Belongs here: e.g. createPost saves a new post with score 0 and commentCount 0, and votePost updates a post's score.

import * as db from "../db/index.js";

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
