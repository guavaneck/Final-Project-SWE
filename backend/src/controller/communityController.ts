import type { Request, Response } from "express";
import * as db from "../db/index.js";

//GET /api/communities
export async function listCommunities(_req: Request, res: Response) {
  res.json(await db.listPublicCommunities());
}
