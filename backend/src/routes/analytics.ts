import { Router } from "express";
import * as analytics from "../controller/analyticsController.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();
router.get("/creator", requireAuth, analytics.getCreatorAnalytics);
export default router;
