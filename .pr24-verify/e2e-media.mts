// Temporary end-to-end check of media uploads (issue #5) against the running dev server. Not part of the change.
import { closeDatabase, createCommunity, prisma } from "../backend/src/db/index.js";
import { signUpload, statObject } from "../backend/src/storage/objectStorage.js";
import { readFileSync } from "node:fs";

// Uploads are now checked with ffprobe, so successful ones must be real media files.
const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));

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
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, json };
}
const expect = (name: string, r: { status: number; json: any }, status: number) =>
  check(`${name} [${status}]`, r.status === status, r.status === status ? undefined : { got: r.status, body: r.json });

async function register(name: string) {
  const username = `${name}_${run}`;
  const r = await call("POST", "/auth/register", undefined, {
    username, email: `${username}@example.com`, displayName: name, password: "correct-horse-battery",
  });
  return { token: r.json.token as string, id: r.json.user.id as string };
}

const bytes = (n: number, seed = 1) => Uint8Array.from({ length: n }, (_, i) => (i * 31 + seed) % 256);
const put = (url: string, data: Uint8Array, type: string) =>
  fetch(url, { method: "PUT", body: data, headers: { "Content-Type": type } });

// Starts, uploads, and completes a file. Returns the media ID.
async function upload(token: string, data: Uint8Array, type = "video/mp4") {
  const start = await call("POST", "/media", token, { mimeType: type, sizeBytes: data.length });
  await put(start.json.upload.url, data, type);
  const done = await call("POST", `/media/${start.json.media.id}/complete`, token);
  return done.json.id as string;
}

const alice = await register("alice");
const bob = await register("bob");
const community = await createCommunity({ creatorId: alice.id, slug: `media-${run}`, name: "Media test" });

console.log("\n== POST /api/media (start upload)");
expect("no auth", await call("POST", "/media", undefined, { mimeType: "video/mp4", sizeBytes: 10 }), 401);
expect("unsupported type", await call("POST", "/media", alice.token, { mimeType: "application/pdf", sizeBytes: 10 }), 400);
expect("svg rejected", await call("POST", "/media", alice.token, { mimeType: "image/svg+xml", sizeBytes: 10 }), 400);
expect("video over 500 MB", await call("POST", "/media", alice.token, { mimeType: "video/mp4", sizeBytes: 500 * 1024 * 1024 + 1 }), 400);
expect("image over 20 MB", await call("POST", "/media", alice.token, { mimeType: "image/png", sizeBytes: 20 * 1024 * 1024 + 1 }), 400);
expect("zero size", await call("POST", "/media", alice.token, { mimeType: "video/mp4", sizeBytes: 0 }), 400);
expect("size as string", await call("POST", "/media", alice.token, { mimeType: "video/mp4", sizeBytes: "10" }), 400);

const video = fixture("ok.mp4");
const start = await call("POST", "/media", alice.token, { mimeType: "video/mp4", sizeBytes: video.length });
expect("start video upload", start, 201);
const M = start.json.media;
check("starts pending with no view url", M.uploadStatus === "pending" && M.url === null, M);
check("response hides bucket/objectKey", !("objectKey" in M) && !("bucket" in M), M);
check("upload instructions", start.json.upload.method === "PUT" && start.json.upload.headers["Content-Type"] === "video/mp4", start.json.upload);

console.log("\n== Uploading to storage + completing");
expect("complete before PUT", await call("POST", `/media/${M.id}/complete`, alice.token), 409);
let r: Response = await put(start.json.upload.url, bytes(1000), "video/mp4");
check("storage rejects wrong size [403]", r.status === 403, r.status);
r = await put(start.json.upload.url, video, "video/webm");
check("storage rejects wrong type [403]", r.status === 403, r.status);
r = await put(start.json.upload.url, video, "video/mp4");
check("storage accepts matching upload [200]", r.status === 200, r.status);
expect("other user can't complete", await call("POST", `/media/${M.id}/complete`, bob.token), 404);
expect("malformed media id", await call("POST", `/media/not-a-uuid/complete`, alice.token), 404);
let done = await call("POST", `/media/${M.id}/complete`, alice.token);
expect("complete", done, 200);
check("now ready with a url", done.json.uploadStatus === "ready" && typeof done.json.url === "string", done.json);
expect("complete again is idempotent", await call("POST", `/media/${M.id}/complete`, alice.token), 200);
const fetched = new Uint8Array(await (await fetch(done.json.url)).arrayBuffer());
check("view url serves the same bytes", fetched.length === video.length && fetched.every((b, i) => b === video[i]), fetched.length);
expect("owner can GET media", await call("GET", `/media/${M.id}`, alice.token), 200);
expect("other user can't GET media", await call("GET", `/media/${M.id}`, bob.token), 404);

console.log("\n== Client lies about the file");
// A client with its own signed URL for the same key could upload different bytes; simulate that with the storage module.
const liar = await call("POST", "/media", alice.token, { mimeType: "video/mp4", sizeBytes: 5000 });
const objectKey = (await prisma.mediaObject.findUnique({ where: { id: liar.json.media.id } }))!.objectKey;
await put(await signUpload(objectKey, "image/png", 10, 60), bytes(10), "image/png");
const mismatch = await call("POST", `/media/${liar.json.media.id}/complete`, alice.token);
expect("mismatched file rejected", mismatch, 422);
check("mismatched object deleted", (await statObject(objectKey)) === null);
check("media marked failed", (await call("GET", `/media/${liar.json.media.id}`, alice.token)).json?.uploadStatus === "failed");
expect("complete after failure", await call("POST", `/media/${liar.json.media.id}/complete`, alice.token), 409);

console.log("\n== Media posts");
const post = (token: string, extra: object) =>
  call("POST", "/posts", token, { communityId: community.id, postType: "media", title: "Clip", ...extra });
const pending = await call("POST", "/media", alice.token, { mimeType: "video/mp4", sizeBytes: 10 });
const bobMedia = await upload(bob.token, fixture("ok.mp4"));
expect("media post without mediaIds", await post(alice.token, {}), 400);
expect("empty mediaIds", await post(alice.token, { mediaIds: [] }), 400);
expect("5 mediaIds", await post(alice.token, { mediaIds: Array(5).fill(M.id) }), 400);
expect("duplicate mediaIds", await post(alice.token, { mediaIds: [M.id, M.id] }), 400);
expect("malformed mediaIds", await post(alice.token, { mediaIds: ["nope"] }), 400);
expect("text post with mediaIds", await post(alice.token, { postType: "text", body: "b", mediaIds: [M.id] }), 400);
expect("text post with empty mediaIds ok", await post(alice.token, { postType: "text", body: "b", mediaIds: [] }), 201);
expect("pending media", await post(alice.token, { mediaIds: [pending.json.media.id] }), 409);
expect("someone else's media", await post(alice.token, { mediaIds: [bobMedia] }), 409);
expect("failed media", await post(alice.token, { mediaIds: [liar.json.media.id] }), 409);

const image = await upload(alice.token, fixture("ok.png"), "image/png");
const created = await post(alice.token, { body: "with caption", mediaIds: [image, M.id] });
expect("create media post", created, 201);
const media = created.json?.media ?? [];
check("media in given order", media.map((m: any) => m.id).join() === [image, M.id].join(), media);
check("media have view urls and numeric sizes", media.every((m: any) => m.url && typeof m.sizeBytes === "number"), media);
check("post media hide objectKey", media.every((m: any) => !("objectKey" in m)), media);
expect("reuse attached media", await post(alice.token, { mediaIds: [M.id] }), 409);
check("GET /media shows postId", (await call("GET", `/media/${M.id}`, alice.token)).json?.postId === created.json.id);

const got = await call("GET", `/posts/${created.json.publicId}`);
check("GET post includes media urls", got.json?.media?.length === 2 && got.json.media.every((m: any) => m.url), got.json?.media);
const feed = await call("GET", `/communities/${community.id}/posts`);
const inFeed = feed.json?.posts?.find((p: any) => p.id === created.json.id);
check("community feed includes media", inFeed?.media?.length === 2, inFeed);
check("text posts have empty media", feed.json?.posts?.filter((p: any) => p.postType === "text").every((p: any) => Array.isArray(p.media) && p.media.length === 0));
const home = await call("GET", "/posts/feed", alice.token);
check("home feed includes media", home.json?.posts?.find((p: any) => p.id === created.json.id)?.media?.length === 2);
const edited = await call("PATCH", `/posts/${created.json.publicId}`, alice.token, { title: "Clip (edited)" });
check("PATCH response keeps media", edited.status === 200 && edited.json?.media?.length === 2, edited.json);

console.log("\n== Two posts racing for the same media");
const contested = await upload(alice.token, fixture("ok.mov"), "video/quicktime");
const results = await Promise.all([post(alice.token, { mediaIds: [contested] }), post(alice.token, { mediaIds: [contested] })]);
const statuses = results.map((x) => x.status).sort();
check("exactly one wins, the other gets 409", statuses.join() === "201,409", results.map((x) => [x.status, x.json?.error]));

console.log("\n== Bigger file");
const big = fixture("exactly-8k.mp4");
const bigId = await upload(alice.token, big);
const bigMedia = await call("GET", `/media/${bigId}`, alice.token);
check("8K video upload completes", bigMedia.json?.uploadStatus === "ready" && bigMedia.json.sizeBytes === big.length, bigMedia.json);

console.log(`\n${pass} passed, ${failures.length} failed`);
for (const f of failures) console.log(`  FAIL ${f}`);
await closeDatabase();
process.exitCode = failures.length ? 1 : 0;
