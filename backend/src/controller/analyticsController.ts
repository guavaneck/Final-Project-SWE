import type { Request, Response } from "express";
import * as db from "../db/index.js";
import { authenticatedUser } from "../middleware/auth.js";

export async function getCreatorAnalytics(req: Request, res: Response) {
  const rawRange = typeof req.query.range === "string" ? req.query.range : "30d";
  const ranges = { "7d": 7, "30d": 30, "90d": 90 } as const;
  const range = ranges[rawRange as keyof typeof ranges];
  if (!range) return res.status(400).json({ error: "range must be 7d, 30d, or 90d" });
  res.json(await db.creatorAnalytics(authenticatedUser(req).id, range));
}

export async function viewPost(req: Request<{ postId: string }>, res: Response) {
  const publicId = db.normalizePublicId(req.params.postId);
  const post = publicId ? await db.getPostByPublicId(publicId) : null;
  if (!post) return res.status(404).json({ error: "Post not found" });
  const counted = await db.recordPostView(post.id, authenticatedUser(req).id);
  res.status(201).json({ counted });
}

export async function sharePost(req: Request<{ postId: string }>, res: Response) {
  const publicId = db.normalizePublicId(req.params.postId);
  const post = publicId ? await db.getPostByPublicId(publicId) : null;
  if (!post) return res.status(404).json({ error: "Post not found" });
  await db.recordPostShare(post.id, authenticatedUser(req).id);
  res.status(201).json({ shared: true });
}
