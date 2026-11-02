// Maps /api/media URLs to controller functions. Only says which URL + HTTP method runs which function.
// Belongs here: e.g. "POST /api/media runs startUpload from mediaController". No logic or database calls.

import { Router } from "express";
import * as media from "../controller/mediaController.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

router.post("/", requireAuth, media.startUpload);
router.get("/:mediaId", requireAuth, media.getMedia);
router.post("/:mediaId/complete", requireAuth, media.completeUpload);

export default router;
