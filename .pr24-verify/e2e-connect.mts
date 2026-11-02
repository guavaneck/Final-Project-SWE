// Temporary end-to-end check of PR #27 (connect-api) against the running dev server. Not part of the PR.
import { closeDatabase, createCommunity, joinCommunity, prisma } from "../backend/src/db/index.js";

const BASE = process.env.BASE ?? "http://localhost:3000";
const API = `${BASE}/api`;
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
const expect = (name: string, r: { status: number; json: any }, status: number) =>
  check(`${name} [${status}]`, r.status === status, r.status === status ? undefined : { got: r.status, body: r.json });
async function register(name: string) {
  const username = `${name}_${run}`;
  const r = await call("POST", "/auth/register", undefined, { username, email: `${username}@example.com`, displayName: name, password: "correct-horse-battery" });
  return { token: r.json.token as string, id: r.json.user.id as string, username };
}

console.log("== Express serves the frontend");
let res = await fetch(`${BASE}/`);
const html = await res.text();
check("GET / serves index.html", res.status === 200 && html.includes("/frontend/src/app.js"), res.status);
for (const file of ["app.js", "api.js", "stylesheet.css"]) {
  res = await fetch(`${BASE}/frontend/src/${file}`);
  check(`GET /frontend/src/${file}`, res.status === 200 && (await res.text()).length > 0, res.status);
}
res = await fetch(`${BASE}/frontend/src/nope.js`);
check("missing frontend file is 404", res.status === 404, res.status);
res = await fetch(`${BASE}/frontend/src/%2e%2e/%2e%2e/.env`);
const envBody = await res.text();
check("path traversal to .env is blocked", res.status >= 400 && !envBody.includes("POSTGRES_PASSWORD"), res.status);
res = await fetch(`${BASE}/frontend/src/..%2F..%2F.env`);
check("encoded-slash traversal is blocked", res.status >= 400 && !(await res.text()).includes("POSTGRES_PASSWORD"), res.status);

const alice = await register("alice");
const bob = await register("bob");
const carol = await register("carol");
const pub = await createCommunity({ creatorId: alice.id, slug: `pub-${run}`, name: "Public one", description: "desc" });
const priv = await createCommunity({ creatorId: alice.id, slug: `priv-${run}`, name: "Private one", visibility: "private" });
await joinCommunity(pub.id, bob.id);

console.log("\n== GET /api/communities");
let r = await call("GET", "/communities");
expect("list communities (no auth needed)", r, 200);
const mine = r.json?.find?.((c: any) => c.id === pub.id);
check("includes public community with member count", mine?._count?.memberships === 2 && mine.slug === pub.slug, mine);
check("excludes private communities", !r.json?.some?.((c: any) => c.id === priv.id));
const names = (r.json ?? []).map((c: any) => c.name);
check("sorted by name", JSON.stringify(names) === JSON.stringify([...names].sort((a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0))), names.slice(0, 5));

const post = (await call("POST", "/posts", alice.token, { communityId: pub.id, postType: "text", title: "Vote on me", body: "b" })).json;
const P = post.publicId;
check("new post starts with score 0", post.score === 0, post);

console.log("\n== Post votes");
expect("vote needs auth", await call("PUT", `/posts/${P}/vote`, undefined, { value: 1 }), 401);
for (const bad of [undefined, 0, 2, -2, "1", true, null, 1.0001]) {
  expect(`value ${JSON.stringify(bad)} rejected`, await call("PUT", `/posts/${P}/vote`, bob.token, bad === undefined ? {} : { value: bad }), 400);
}
r = await call("PUT", `/posts/${P}/vote`, bob.token, { value: 1 });
check("upvote -> score 1, viewerVote 1", r.status === 200 && r.json.score === 1 && r.json.viewerVote === 1, r);
r = await call("PUT", `/posts/${P}/vote`, bob.token, { value: 1 });
check("upvote again is idempotent", r.json?.score === 1 && r.json.viewerVote === 1, r.json);
r = await call("PUT", `/posts/${P}/vote`, carol.token, { value: 1 });
check("second voter -> score 2", r.json?.score === 2, r.json);
r = await call("PUT", `/posts/${P}/vote`, bob.token, { value: -1 });
check("switch to downvote -> score 0, viewerVote -1", r.json?.score === 0 && r.json.viewerVote === -1, r.json);
r = await call("DELETE", `/posts/${P}/vote`, bob.token);
check("remove vote -> score 1, viewerVote 0", r.status === 200 && r.json.score === 1 && r.json.viewerVote === 0, r);
r = await call("DELETE", `/posts/${P}/vote`, bob.token);
check("remove again is idempotent", r.status === 200 && r.json.score === 1, r);
expect("vote on unknown post", await call("PUT", `/posts/ZZZZZZZZZZZZ/vote`, bob.token, { value: 1 }), 404);
expect("old /like endpoint is gone", await call("PUT", `/posts/${P}/like`, bob.token), 404);

console.log("\n== viewerVote in responses");
await call("PUT", `/posts/${P}/vote`, bob.token, { value: -1 });
r = await call("GET", `/posts/${P}`, bob.token);
check("GET post as voter shows viewerVote -1, score 0", r.json?.viewerVote === -1 && r.json.score === 0, r.json);
r = await call("GET", `/posts/${P}`, carol.token);
check("GET post as other voter shows their +1", r.json?.viewerVote === 1, r.json);
r = await call("GET", `/posts/${P}`);
check("GET post anonymously: viewerVote 0", r.status === 200 && r.json.viewerVote === 0, r);
r = await call("GET", `/posts/${P}`, "not-a-real-token");
check("GET post with a bad token is 401 (optionalAuth)", r.status === 401, r.status);
r = await call("GET", `/communities/${pub.id}/posts`, bob.token);
check("community feed includes score + viewerVote", r.json?.posts?.[0]?.viewerVote === -1 && r.json.posts[0].score === 0, r.json?.posts?.[0]);
r = await call("GET", `/communities/${pub.id}/posts`);
check("community feed anonymous: viewerVote 0", r.json?.posts?.[0]?.viewerVote === 0, r.json?.posts?.[0]);
r = await call("GET", "/posts/feed", bob.token);
check("home feed includes viewerVote", r.json?.posts?.find((p: any) => p.publicId === P)?.viewerVote === -1, r.json);

console.log("\n== Comment votes, nested replies");
const c1 = (await call("POST", `/posts/${P}/comments`, bob.token, { body: "top" })).json;
const c2 = (await call("POST", `/posts/${P}/comments`, carol.token, { body: "reply", parentId: c1.id })).json;
const c3 = (await call("POST", `/posts/${P}/comments`, alice.token, { body: "reply to reply", parentId: c2.id })).json;
const C = (id: string) => `/posts/${P}/comments/${id}/vote`;
expect("comment vote needs auth", await call("PUT", C(c1.id), undefined, { value: 1 }), 401);
expect("comment vote bad value", await call("PUT", C(c1.id), bob.token, { value: 5 }), 400);
r = await call("PUT", C(c3.id), bob.token, { value: 1 });
check("upvote nested reply", r.json?.score === 1 && r.json.viewerVote === 1, r.json);
await call("PUT", C(c3.id), carol.token, { value: -1 });
await call("PUT", C(c1.id), carol.token, { value: -1 });
r = await call("GET", `/posts/${P}/comments`, bob.token);
const t1 = r.json?.[0], t3 = t1?.replies?.[0]?.replies?.[0];
check("thread is nested 3 deep", t1?.id === c1.id && t1.replies[0].id === c2.id && t3?.id === c3.id, r.json);
check("nested reply: score 0, bob's viewerVote 1", t3?.score === 0 && t3.viewerVote === 1, t3);
check("top comment: score -1, bob's viewerVote 0", t1?.score === -1 && t1.viewerVote === 0, t1);
r = await call("GET", `/posts/${P}/comments`);
check("anonymous thread: all viewerVote 0", r.json?.[0]?.viewerVote === 0 && r.json[0].replies[0].replies[0].viewerVote === 0);
r = await call("DELETE", C(c3.id), bob.token);
check("remove comment vote", r.json?.score === -1 && r.json.viewerVote === 0, r.json);
const other = (await call("POST", "/posts", alice.token, { communityId: pub.id, postType: "text", title: "Other", body: "b" })).json;
expect("vote on a comment through the wrong post", await call("PUT", `/posts/${other.publicId}/comments/${c1.id}/vote`, bob.token, { value: 1 }), 404);
await call("DELETE", `/posts/${P}/comments/${c2.id}`, carol.token);
expect("vote on a deleted comment", await call("PUT", C(c2.id), bob.token, { value: 1 }), 404);
expect("old comment /like endpoint is gone", await call("PUT", `/posts/${P}/comments/${c1.id}/like`, bob.token), 404);

console.log("\n== Concurrency and score integrity");
const race = (await call("POST", "/posts", alice.token, { communityId: pub.id, postType: "text", title: "Race", body: "b" })).json;
const same = await Promise.all(Array.from({ length: 8 }, () => call("PUT", `/posts/${race.publicId}/vote`, bob.token, { value: 1 })));
check("8 simultaneous identical upvotes all succeed", same.every((x) => x.status === 200), same.map((x) => [x.status, x.json?.error]));
const flips = await Promise.all(Array.from({ length: 10 }, (_, i) => call("PUT", `/posts/${race.publicId}/vote`, carol.token, { value: i % 2 ? 1 : -1 })));
check("10 simultaneous up/down flips all succeed", flips.every((x) => x.status === 200), flips.map((x) => [x.status, x.json?.error]));
const row = await prisma.post.findUnique({ where: { id: race.id }, select: { score: true } });
const sum = await prisma.postVote.aggregate({ where: { postId: race.id }, _sum: { value: true }, _count: true });
check("stored score equals the sum of votes", row?.score === (sum._sum.value ?? 0) && sum._count === 2, { score: row?.score, sum: sum._sum.value, votes: sum._count });

console.log("\n== Deleted posts");
await call("DELETE", `/posts/${other.publicId}`, alice.token);
expect("vote on a deleted post", await call("PUT", `/posts/${other.publicId}/vote`, bob.token, { value: 1 }), 404);

console.log(`\n${pass} passed, ${failures.length} failed`);
for (const f of failures) console.log(`  FAIL ${f}`);
console.log(`\nTest community "${pub.name}" (${pub.id}); users *_${run} / correct-horse-battery`);
await closeDatabase();
process.exitCode = failures.length ? 1 : 0;
