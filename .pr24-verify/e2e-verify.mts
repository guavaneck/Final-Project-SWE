// Temporary end-to-end check of content verification, post-deletion cleanup, and abandoned-upload cleanup.
import { readFileSync } from "node:fs";
import { closeDatabase, createCommunity, prisma } from "../backend/src/db/index.js";
import { cleanUpAbandonedMedia } from "../backend/src/services/mediaService.js";
import { statObject } from "../backend/src/storage/objectStorage.js";

const API = process.env.API ?? "http://localhost:3000/api";
const run = Date.now().toString(36);
let pass = 0;
const failures: string[] = [];
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) pass++;
  else failures.push(`${name} -> ${JSON.stringify(detail)}`);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || detail === undefined ? "" : `  ${JSON.stringify(detail).slice(0, 300)}`}`);
}
async function call(method: string, path: string, token?: string, body?: unknown) {
  const res = await fetch(API + path, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, json };
}
const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));
const keyOf = async (id: string) => (await prisma.mediaObject.findUnique({ where: { id } }))?.objectKey ?? null;

const reg = await call("POST", "/auth/register", undefined, {
  username: `verify_${run}`, email: `verify_${run}@example.com`, displayName: "verify", password: "correct-horse-battery",
});
const token = reg.json.token as string;
const userId = reg.json.user.id as string;
const community = await createCommunity({ creatorId: userId, slug: `verify-${run}`, name: "Verify media" });

// Starts and PUTs a file; returns the media ID and the /complete response.
async function upload(file: string, mimeType: string, complete = true) {
  const data = fixture(file);
  const start = await call("POST", "/media", token, { mimeType, sizeBytes: data.length });
  if (start.status !== 201) return { id: null, done: start };
  const put = await fetch(start.json.upload.url, { method: "PUT", body: data, headers: start.json.upload.headers });
  if (!put.ok) throw new Error(`PUT ${file} failed: ${put.status}`);
  const id = start.json.media.id as string;
  return { id, done: complete ? await call("POST", `/media/${id}/complete`, token) : null };
}

console.log("\n== Real files are accepted and measured");
const accepted: [string, string, number, number, number | null][] = [
  ["ok.mp4", "video/mp4", 640, 360, 4],
  ["ok.mov", "video/quicktime", 640, 360, 4],
  ["ok.webm", "video/webm", 640, 360, 4.008],
  ["moov-at-end.mp4", "video/mp4", 640, 360, 4],
  ["portrait.mp4", "video/mp4", 360, 640, 4],
  ["exactly-8k.mp4", "video/mp4", 7680, 4320, 1],
  ["ok.png", "image/png", 320, 240, null],
  ["ok.jpg", "image/jpeg", 320, 240, null],
  ["ok.gif", "image/gif", 160, 120, null],
  ["ok.webp", "image/webp", 320, 240, null],
  ["animated.webp", "image/webp", 160, 120, null],
];
const readyIds: string[] = [];
for (const [file, type, w, h, d] of accepted) {
  const { id, done } = await upload(file, type);
  const m = done!.json;
  const ok = done!.status === 200 && m.uploadStatus === "ready" && m.width === w && m.height === h && m.durationSeconds === d;
  check(`${file} as ${type} -> ${w}x${h}${d ? `, ${d}s` : ""}`, ok, { status: done!.status, body: m });
  if (id && ok) readyIds.push(id);
}

console.log("\n== Files that aren't what they claim, or break the limits, are rejected");
const rejected: [string, string, RegExp][] = [
  ["not-a-video.mp4", "video/mp4", /isn't a valid video\/mp4/],
  ["ok.png", "video/mp4", /isn't a valid video\/mp4/],
  ["ok.webm", "video/mp4", /isn't a valid video\/mp4/],
  ["ok.mp4", "video/webm", /isn't a valid video\/webm/],
  ["h264-in.mkv", "video/webm", /WebM videos must use/],
  ["audio-only.mp4", "video/mp4", /no video track/],
  ["ok.jpg", "image/png", /isn't a valid image\/png/],
  ["ok.png", "image/jpeg", /isn't a valid image\/jpeg/],
  ["ok.gif", "image/webp", /isn't a valid image\/webp/],
  ["ok.mp4", "image/gif", /isn't a valid image\/gif/],
  ["too-wide.png", "image/png", /8K/],
  ["too-long.mp4", "video/mp4", /2 hours/],
];
for (const [file, type, pattern] of rejected) {
  const { id, done } = await upload(file, type);
  const key = id ? await keyOf(id) : null;
  const stored = key ? await statObject(key) : "no key";
  const status = id ? (await call("GET", `/media/${id}`, token)).json?.uploadStatus : null;
  check(
    `${file} as ${type} rejected, deleted, marked failed`,
    done!.status === 422 && pattern.test(done!.json?.error) && stored === null && status === "failed",
    { status: done!.status, error: done!.json?.error, stored, uploadStatus: status },
  );
}

console.log("\n== Deleting a post deletes its files");
const post = await call("POST", "/posts", token, {
  communityId: community.id, postType: "media", title: "Delete me", mediaIds: readyIds.slice(0, 3),
});
check("media post created", post.status === 201 && post.json.media.length === 3, post);
const postKeys = await Promise.all(readyIds.slice(0, 3).map(keyOf));
check("files exist before delete", (await Promise.all(postKeys.map((k) => statObject(k!)))).every(Boolean));
const del = await call("DELETE", `/posts/${post.json.publicId}`, token);
check("post deleted [204]", del.status === 204, del);
check("files gone from storage", (await Promise.all(postKeys.map((k) => statObject(k!)))).every((s) => s === null));
check("media rows gone", (await prisma.mediaObject.count({ where: { id: { in: readyIds.slice(0, 3) } } })) === 0);
check("post is 404", (await call("GET", `/posts/${post.json.publicId}`)).status === 404);
const other = await call("GET", `/media/${readyIds[3]}`, token);
check("unrelated media untouched", other.status === 200 && other.json.uploadStatus === "ready", other);

console.log("\n== Abandoned uploads are cleaned up");
const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000);
// Never completed, but the file did get uploaded; started 2 hours ago.
const stale = await upload("ok.png", "image/png", false);
await prisma.mediaObject.update({ where: { id: stale.id! }, data: { createdAt: hoursAgo(2) } });
// Never completed and never uploaded; 2 hours old.
const staleEmpty = await call("POST", "/media", token, { mimeType: "video/mp4", sizeBytes: 1000 });
await prisma.mediaObject.update({ where: { id: staleEmpty.json.media.id }, data: { createdAt: hoursAgo(2) } });
// Pending but recent: someone is mid-upload.
const fresh = await upload("ok.jpg", "image/jpeg", false);
// Failed 2 hours ago.
const failed = await upload("not-a-video.mp4", "video/mp4");
await prisma.mediaObject.update({ where: { id: failed.id! }, data: { createdAt: hoursAgo(2) } });
// Finished 25 hours ago but never posted.
if (readyIds.length < 7) throw new Error(`Need 7 ready uploads for the cleanup checks, got ${readyIds.length}`);
const unposted = readyIds[4]!;
await prisma.mediaObject.update({ where: { id: unposted }, data: { completedAt: hoursAgo(25) } });
// Finished 25 hours ago and on a post: must survive.
const kept = readyIds[5]!;
const keptPost = await call("POST", "/posts", token, { communityId: community.id, postType: "media", title: "Keep", mediaIds: [kept] });
await prisma.mediaObject.update({ where: { id: kept }, data: { completedAt: hoursAgo(25) } });
// Finished recently, not posted yet: the user may still be writing the post.
const recent = readyIds[6]!;

const keys = Object.fromEntries(await Promise.all(
  [stale.id!, fresh.id!, unposted, kept, recent].map(async (id) => [id, await keyOf(id)] as const),
));
const removed = await cleanUpAbandonedMedia();
check("cleanup reports removals", removed >= 4, removed);
const exists = async (id: string) => (await prisma.mediaObject.count({ where: { id } })) === 1;
check("stale pending upload removed (row + file)", !(await exists(stale.id!)) && (await statObject(keys[stale.id!]!)) === null);
check("stale empty pending upload removed", !(await exists(staleEmpty.json.media.id)));
check("old failed upload removed", !(await exists(failed.id!)));
check("unposted upload removed after a day (row + file)", !(await exists(unposted)) && (await statObject(keys[unposted]!)) === null);
check("fresh pending upload kept", (await exists(fresh.id!)) && (await statObject(keys[fresh.id!]!)) !== null);
check("old media on a post kept", (await exists(kept)) && (await statObject(keys[kept]!)) !== null);
check("post still shows its media", (await call("GET", `/posts/${keptPost.json.publicId}`)).json?.media?.length === 1);
check("recent unposted upload kept", await exists(recent));

console.log(`\n${pass} passed, ${failures.length} failed`);
for (const f of failures) console.log(`  FAIL ${f}`);
await closeDatabase();
process.exitCode = failures.length ? 1 : 0;
