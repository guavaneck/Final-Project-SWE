// Maps /api/users URLs to controller functions. Only says which URL + HTTP method runs which function.
// Belongs here: e.g. "GET /api/users/:userId runs getUser from a user controller". No logic or database calls.
import { Router } from "express";
import * as users from "../controller/userController.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

router.get("/me/following", requireAuth, users.listFollowing);
router.put("/:userId/follow", requireAuth, users.follow);
router.delete("/:userId/follow", requireAuth, users.unfollow);

export default router;
