// Entry point for the backend: creates the app, plugs in the routers from routes/, and starts the server.
// Belongs here: app setup and listen(), e.g. registering the posts router under /api/posts. No business logic.

import express, { type NextFunction, type Request, type Response } from "express";
import { fileURLToPath } from "node:url";
import postsRouter from "./routes/posts.js";

const app = express();
const port = Number(process.env.PORT ?? 3000);

app.use(express.json());

app.use("/api/posts", postsRouter);

app.use("/api", (_req, res) => {
  res.status(404).json({ error: "Not found" });
});

// Serves the mock frontend, so the page and the API share one origin (no CORS needed).
app.use(express.static(fileURLToPath(new URL("../../frontend/src", import.meta.url))));

// Express 5 forwards errors thrown in async handlers here.
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});
