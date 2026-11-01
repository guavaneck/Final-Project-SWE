// Entry point for the backend: creates the app, plugs in the routers from routes/, and starts the server.
// Belongs here: app setup and listen(), e.g. registering the posts router under /api/posts. No business logic.

import express, { type NextFunction, type Request, type Response } from "express";
import postsRouter from "./routes/posts.js";
import authRouter from "./routes/auth.js";

const app = express();
const port = Number(process.env.PORT ?? 3000);

app.use(express.json());

app.use("/api/auth", authRouter);
app.use("/api/posts", postsRouter);

app.use("/api", (_req, res) => {
  res.status(404).json({ error: "Not found" });
});

// Express 5 forwards errors thrown in async handlers here.
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  // express.json() reports bad request bodies (malformed JSON, too large, unsupported charset) with a 4xx status.
  // Those are the client's mistake, so pass the status through instead of a 500.
  const { status, type } = err as { status?: unknown; type?: unknown };
  if (typeof status === "number" && status >= 400 && status < 500) {
    const error =
      type === "entity.parse.failed" ? "Request body must be valid JSON"
      : type === "entity.too.large" ? "Request body is too large"
      : "Request body could not be read";
    return res.status(status).json({ error });
  }
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});
