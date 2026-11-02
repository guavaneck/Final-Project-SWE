// Temporary dev server for trying PR #24 by hand. Not part of the PR.
// Serves index.html, forwards /api/* to the backend (so no CORS is needed),
// and adds /dev/* helpers for things the API doesn't cover yet: communities, joining, following.
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
  createCommunity, followUser, joinCommunity, leaveCommunity, prisma, unfollowUser,
} from "../backend/src/db/index.js";

const PORT = Number(process.env.PORT ?? 5173);
const BACKEND = process.env.BACKEND ?? "http://localhost:3000";
const page = new URL("./index.html", import.meta.url);

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

function send(res: ServerResponse, status: number, data?: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(data === undefined ? "" : JSON.stringify(data));
}

async function proxy(req: IncomingMessage, res: ServerResponse) {
  const body = await readBody(req);
  const headers: Record<string, string> = {};
  for (const name of ["authorization", "content-type"]) {
    const value = req.headers[name];
    if (typeof value === "string") headers[name] = value;
  }
  const upstream = await fetch(BACKEND + req.url, {
    method: req.method,
    headers,
    body: body.length && req.method !== "GET" && req.method !== "HEAD" ? body : undefined,
  });
  res.writeHead(upstream.status, { "Content-Type": upstream.headers.get("content-type") ?? "text/plain" });
  res.end(Buffer.from(await upstream.arrayBuffer()));
}

// Resolves the caller from their bearer token by asking the real API, so /dev/* uses the same auth.
async function currentUser(req: IncomingMessage): Promise<{ id: string } | null> {
  if (!req.headers.authorization) return null;
  const r = await fetch(`${BACKEND}/api/auth/me`, { headers: { authorization: req.headers.authorization } });
  return r.ok ? ((await r.json()) as { user: { id: string } }).user : null;
}

async function dev(req: IncomingMessage, res: ServerResponse) {
  const user = await currentUser(req);
  const url = new URL(req.url!, "http://x");
  const parts = url.pathname.split("/").filter(Boolean); // ["dev", ...]
  const method = req.method;

  if (parts[1] === "communities" && parts.length === 2 && method === "GET") {
    const rows = await prisma.community.findMany({
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { memberships: true, posts: true } } },
    });
    const joined = user
      ? new Set((await prisma.communityMembership.findMany({ where: { userId: user.id } })).map((m) => m.communityId))
      : new Set<string>();
    return send(res, 200, rows.map((c) => ({
      id: c.id, name: c.name, slug: c.slug, description: c.description,
      members: c._count.memberships, posts: c._count.posts, joined: joined.has(c.id),
    })));
  }

  if (!user) return send(res, 401, { error: "Log in first" });

  if (parts[1] === "communities" && parts.length === 2 && method === "POST") {
    const { name, description } = JSON.parse((await readBody(req)).toString() || "{}");
    if (typeof name !== "string" || !name.trim()) return send(res, 400, { error: "name is required" });
    const slug = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "c"}-${Date.now().toString(36)}`;
    const community = await createCommunity({
      creatorId: user.id, name: name.trim().slice(0, 100), slug, description: description || undefined,
    });
    return send(res, 201, community);
  }

  if (parts[1] === "communities" && parts[3] === "join") {
    if (method === "PUT") { await joinCommunity(parts[2]!, user.id); return send(res, 200, { joined: true }); }
    if (method === "DELETE") { await leaveCommunity(parts[2]!, user.id); return send(res, 200, { joined: false }); }
  }

  if (parts[1] === "users" && parts.length === 2 && method === "GET") {
    const [users, follows] = await Promise.all([
      prisma.user.findMany({
        where: { deletedAt: null, NOT: { id: user.id } },
        select: { id: true, username: true, displayName: true },
        orderBy: { createdAt: "desc" },
        take: 200,
      }),
      prisma.userFollow.findMany({ where: { followerId: user.id }, select: { followedId: true } }),
    ]);
    const following = new Set(follows.map((f) => f.followedId));
    return send(res, 200, users.map((u) => ({ ...u, following: following.has(u.id) })));
  }

  if (parts[1] === "users" && parts[3] === "follow") {
    if (method === "PUT") { await followUser(user.id, parts[2]!); return send(res, 200, { following: true }); }
    if (method === "DELETE") { await unfollowUser(user.id, parts[2]!); return send(res, 200, { following: false }); }
  }

  send(res, 404, { error: "Not found" });
}

createServer(async (req, res) => {
  try {
    if (req.url?.startsWith("/api/")) return await proxy(req, res);
    if (req.url?.startsWith("/dev/")) return await dev(req, res);
    if (req.url === "/" || req.url?.startsWith("/index.html")) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      return res.end(await readFile(page));
    }
    send(res, 404, { error: "Not found" });
  } catch (err) {
    console.error(err);
    if (!res.headersSent) send(res, 502, { error: String((err as Error).message ?? err) });
  }
}).listen(PORT, () => console.log(`PR #24 playground on http://localhost:${PORT}`));
