// Entry point for the backend: creates the app, plugs in the routers from routes/, and starts the server.
// Belongs here: app setup and listen(), e.g. registering the posts router under /api/posts. No business logic.

import express, { type NextFunction, type Request, type Response } from "express";
import postsRouter from "./routes/posts.js";
import authRouter from "./routes/auth.js";
import communitiesRouter from "./routes/communities.js";

const app = express();
const port = Number(process.env.PORT ?? 3000);

app.use(express.json());

app.use("/api/auth", authRouter);
app.use("/api/posts", postsRouter);
app.use("/api/communities", communitiesRouter);

app.use("/api", (_req, res) => {
  res.status(404).json({ error: "Not found" });
});

// Express 5 forwards errors thrown in async handlers here.
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});
