// Handles the HTTP side of media uploads: reads the request, checks input, calls mediaService, and sends the response.
// Belongs here: e.g. startUpload checks the declared type and size and returns where to PUT the file. No storage or database calls.

import type { Request, Response } from "express";
import * as mediaService from "../services/mediaService.js";
import { isUuid } from "../services/postService.js";
import { authenticatedUser } from "../middleware/auth.js";

// POST /api/media
// Step 1 of an upload: declare the file, get back a pending media record and a signed URL to PUT the file to.
export async function startUpload(req: Request, res: Response) {
  const ownerId = authenticatedUser(req).id;
  const { mimeType, sizeBytes } = req.body ?? {};
  const error = mediaService.validateUpload(mimeType, sizeBytes);
  if (error) {
    return res.status(400).json({ error });
  }
  res.status(201).json(await mediaService.startUpload(ownerId, mimeType, sizeBytes));
}

// POST /api/media/:mediaId/complete
// Step 2: call after the PUT succeeds. Checks the stored file and marks the media ready to attach to a post.
export async function completeUpload(req: Request<{ mediaId: string }>, res: Response) {
  const ownerId = authenticatedUser(req).id;
  const { mediaId } = req.params;
  const result = isUuid(mediaId) ? await mediaService.finishUpload(mediaId, ownerId) : { outcome: "not_found" as const };

  switch (result.outcome) {
    case "ready":
      return res.json(result.media);
    case "not_found":
      return res.status(404).json({ error: "Media not found" });
    case "not_uploaded":
      return res.status(409).json({ error: "The file hasn't been uploaded yet. PUT it to the upload URL first." });
    case "mismatch":
      return res.status(422).json({ error: result.error });
    case "not_pending":
      return res.status(409).json({ error: `This upload already ${result.status === "failed" ? "failed" : "finished"}. Start a new one.` });
  }
}

// GET /api/media/:mediaId
// The owner's view of their upload, including its status and which post it's on.
export async function getMedia(req: Request<{ mediaId: string }>, res: Response) {
  const ownerId = authenticatedUser(req).id;
  const { mediaId } = req.params;
  const media = isUuid(mediaId) ? await mediaService.getOwnMedia(mediaId, ownerId) : null;
  if (!media) {
    return res.status(404).json({ error: "Media not found" });
  }
  res.json(media);
}
