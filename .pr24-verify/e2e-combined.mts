// Temporary: checks votes (#27) and media (#26) together on the same post after the merge.
import { readFileSync } from "node:fs";
import { closeDatabase, createCommunity, joinCommunity } from "../backend/src/db/index.js";
import { statObject } from "../backend/src/storage/objectStorage.js";
import { prisma } from "../backend/src/db/index.js";

const API = process.env.API ?? "http://localhost:3001/api";
const run = Date.now().toString(36);
let pass = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) pass++; else failures.push(`${name} -> ${JSON.stringify(detail)?.slice(0, 300)}`);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
};
async function call(method: string, path: string, token?: string, body?: unknown) {
  const res = await fetch(API + path, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}
const reg = async (n: string) => (await call("POST", "/auth/register", undefined, { username: `${n}_${run}`, email: `${n}_${run}@example.com`, displayName: n, password: "correct-horse-battery" })).json;
const a = await reg("mix_a"), b = await reg("mix_b");
const community = await createCommunity({ creatorId: a.user.id, slug: `mix-${run}`, name: "Mixed" });
await joinCommunity(community.id, b.user.id);

const file = new Uint8Array(readFileSync(new URL("./fixtures/ok.mp4", import.meta.url)));
const start = await call("POST", "/media", a.token, { mimeType: "video/mp4", sizeBytes: file.length });
await fetch(start.json.upload.url, { method: "PUT", body: file, headers: start.json.upload.headers });
const done = await call("POST", `/media/${start.json.media.id}/complete`, a.token);
check("upload verified", done.status === 200 && done.json.width === 640, done);

const created = await call("POST", "/posts", a.token, { communityId: community.id, postType: "media", title: "Clip", mediaIds: [done.json.id] });
check("media post created with score 0 and media", created.status === 201 && created.json.score === 0 && created.json.media?.[0]?.url, created);
const P = created.json.publicId;
const voted = await call("PUT", `/posts/${P}/vote`, b.token, { value: 1 });
check("vote on a media post", voted.json?.score === 1 && voted.json.viewerVote === 1, voted);

const both = (p: any) => p?.viewerVote === 1 && p.score === 1 && p.media?.length === 1 && typeof p.media[0].url === "string" && !("objectKey" in p.media[0]) && !("_count" in p);
check("GET post: viewerVote + media", both((await call("GET", `/posts/${P}`, b.token)).json));
const anon = (await call("GET", `/posts/${P}`)).json;
check("GET post anonymously: viewerVote 0, media still there", anon?.viewerVote === 0 && anon.media?.length === 1, anon);
check("community feed: viewerVote + media", both((await call("GET", `/communities/${community.id}/posts`, b.token)).json?.posts?.[0]));
check("home feed: viewerVote + media", both((await call("GET", "/posts/feed", b.token)).json?.posts?.find((p: any) => p.publicId === P)));
const edited = await call("PATCH", `/posts/${P}`, a.token, { title: "Clip (edited)" });
check("PATCH keeps media and score", edited.json?.media?.length === 1 && edited.json.score === 1, edited);

const key = (await prisma.mediaObject.findUnique({ where: { id: done.json.id } }))!.objectKey;
check("delete media post [204]", (await call("DELETE", `/posts/${P}`, a.token)).status === 204);
check("its file is gone from storage", (await statObject(key)) === null);
check("vote rows went with it? (post soft-deleted, votes kept)", (await prisma.postVote.count({ where: { post: { publicId: P } } })) === 1);

console.log(`\n${pass} passed, ${failures.length} failed`);
for (const f of failures) console.log(`  FAIL ${f}`);
await closeDatabase();
