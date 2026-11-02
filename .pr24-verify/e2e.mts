// Temporary end-to-end check of PR #24 against the running dev server. Not part of the PR.
import { closeDatabase, createCommunity, followUser, joinCommunity } from "../backend/src/db/index.js";

const API = process.env.API ?? "http://localhost:3000/api";
const run = Date.now().toString(36);
let pass = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) pass++;
  else failures.push(`${name}${detail === undefined ? "" : ` -> ${JSON.stringify(detail)}`}`);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || detail === undefined ? "" : `  ${JSON.stringify(detail)}`}`);
}

async function call(method: string, path: string, token?: string, body?: unknown) {
  const res = await fetch(API + path, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, json };
}

async function register(name: string) {
  const username = `${name}_${run}`;
  const r = await call("POST", "/auth/register", undefined, {
    username, email: `${username}@example.com`, displayName: name, password: "correct-horse-battery",
  });
  if (r.status !== 201 && r.status !== 200) throw new Error(`register ${name}: ${r.status} ${JSON.stringify(r.json)}`);
  return { token: r.json.token as string, id: (r.json.user?.id ?? r.json.id) as string, username };
}

const expect = (name: string, r: { status: number; json: any }, status: number) =>
  check(`${name} [${status}]`, r.status === status, r.status === status ? undefined : { got: r.status, body: r.json });

const alice = await register("alice"); // author
const bob = await register("bob");     // other user
const carol = await register("carol"); // member of c1
const dave = await register("dave");   // follows bob
const erin = await register("erin");   // unrelated

const c1 = await createCommunity({ creatorId: alice.id, slug: `c1-${run}`, name: "Verify One" });
const c2 = await createCommunity({ creatorId: bob.id, slug: `c2-${run}`, name: "Verify Two" });
await joinCommunity(c1.id, carol.id);
await followUser(dave.id, bob.id);

// ---------- Create post validation ----------
console.log("\n== POST /api/posts");
expect("no auth", await call("POST", "/posts", undefined, {}), 401);
expect("missing communityId", await call("POST", "/posts", alice.token, { postType: "text", title: "t", body: "b" }), 400);
expect("malformed communityId", await call("POST", "/posts", alice.token, { communityId: "abc", postType: "text", title: "t", body: "b" }), 400);
expect("unknown community", await call("POST", "/posts", alice.token, { communityId: "00000000-0000-4000-8000-000000000000", postType: "text", title: "t", body: "b" }), 404);
expect("bad postType", await call("POST", "/posts", alice.token, { communityId: c1.id, postType: "video", title: "t", body: "b" }), 400);
expect("blank title", await call("POST", "/posts", alice.token, { communityId: c1.id, postType: "text", title: "   ", body: "b" }), 400);
expect("title 301 chars", await call("POST", "/posts", alice.token, { communityId: c1.id, postType: "text", title: "x".repeat(301), body: "b" }), 400);
expect("title 300 chars ok", await call("POST", "/posts", alice.token, { communityId: c1.id, postType: "link", title: "x".repeat(300), externalUrl: "https://example.com" }), 201);
expect("text w/o body", await call("POST", "/posts", alice.token, { communityId: c1.id, postType: "text", title: "t" }), 400);
expect("text with url", await call("POST", "/posts", alice.token, { communityId: c1.id, postType: "text", title: "t", body: "b", externalUrl: "https://x.com" }), 400);
expect("link w/o url", await call("POST", "/posts", alice.token, { communityId: c1.id, postType: "link", title: "t" }), 400);
expect("link javascript: url", await call("POST", "/posts", alice.token, { communityId: c1.id, postType: "link", title: "t", externalUrl: "javascript:alert(1)" }), 400);
expect("malformed JSON body", await call("POST", "/posts", alice.token, "{not json"), 400);

const textPost = await call("POST", "/posts", alice.token, { communityId: c1.id, postType: "text", title: "  Hello  ", body: "First body" });
expect("create text post", textPost, 201);
check("title is trimmed", textPost.json?.title === "Hello", textPost.json?.title);
const linkPost = await call("POST", "/posts", alice.token, { communityId: c1.id, postType: "link", title: "A link", body: "context", externalUrl: "https://example.com" });
expect("create link post", linkPost, 201);
const P = textPost.json.publicId as string;
const L = linkPost.json.publicId as string;

// ---------- Edit post ----------
console.log("\n== PATCH /api/posts/:postId");
expect("no auth", await call("PATCH", `/posts/${P}`, undefined, { title: "x" }), 401);
expect("non-author", await call("PATCH", `/posts/${P}`, bob.token, { title: "hijack" }), 403);
expect("empty patch", await call("PATCH", `/posts/${P}`, alice.token, {}), 400);
expect("title wrong type", await call("PATCH", `/posts/${P}`, alice.token, { title: 5 }), 400);
expect("body wrong type", await call("PATCH", `/posts/${P}`, alice.token, { body: 5 }), 400);
expect("unknown post", await call("PATCH", `/posts/zzzzzzzz`, alice.token, { title: "x" }), 404);
let r = await call("PATCH", `/posts/${P}`, alice.token, { body: "Edited body" });
expect("partial edit body", r, 200);
check("title unchanged on partial edit", r.json?.title === "Hello", r.json?.title);
check("body updated", r.json?.body === "Edited body", r.json?.body);
check("post updatedAt > createdAt after edit", new Date(r.json?.updatedAt) > new Date(r.json?.createdAt), [r.json?.createdAt, r.json?.updatedAt]);
expect("clear body on text post rejected", await call("PATCH", `/posts/${P}`, alice.token, { body: null }), 400);
expect("whitespace body on text post rejected", await call("PATCH", `/posts/${P}`, alice.token, { body: "   " }), 400);
expect("add url to text post rejected", await call("PATCH", `/posts/${P}`, alice.token, { externalUrl: "https://x.com" }), 400);
expect("blank title rejected", await call("PATCH", `/posts/${P}`, alice.token, { title: "" }), 400);
r = await call("PATCH", `/posts/${L}`, alice.token, { body: "" });
expect("clear body on link post with \"\"", r, 200);
check("link body is null", r.json?.body === null, r.json?.body);
expect("clear url on link post rejected", await call("PATCH", `/posts/${L}`, alice.token, { externalUrl: null }), 400);
r = await call("PATCH", `/posts/${L}`, alice.token, { externalUrl: "http://example.org/x" });
check("change link url", r.status === 200 && r.json?.externalUrl === "http://example.org/x", r.json);
r = await call("GET", `/posts/${P}`);
check("GET reflects edit", r.json?.body === "Edited body" && r.json?.title === "Hello", r.json);

// ---------- Comments ----------
console.log("\n== Comments");
const c = await call("POST", `/posts/${P}/comments`, bob.token, { body: "Bob's comment" });
expect("create comment", c, 201);
check("new comment not marked edited", c.json && new Date(c.json.updatedAt).getTime() <= new Date(c.json.createdAt).getTime(), c.json && [c.json.createdAt, c.json.updatedAt]);
const reply = await call("POST", `/posts/${P}/comments`, alice.token, { body: "Alice replies", parentId: c.json.id });
expect("reply to comment", reply, 201);
expect("parentId malformed", await call("POST", `/posts/${P}/comments`, alice.token, { body: "x", parentId: "nope" }), 400);
expect("parentId unknown", await call("POST", `/posts/${P}/comments`, alice.token, { body: "x", parentId: "00000000-0000-4000-8000-000000000000" }), 404);
const C = `/posts/${P}/comments/${c.json.id}`;
expect("edit comment no auth", await call("PATCH", C, undefined, { body: "x" }), 401);
expect("edit comment non-author", await call("PATCH", C, alice.token, { body: "x" }), 403);
expect("edit comment blank body", await call("PATCH", C, bob.token, { body: "  " }), 400);
expect("edit malformed comment id", await call("PATCH", `/posts/${P}/comments/not-a-uuid`, bob.token, { body: "x" }), 404);
expect("edit comment via wrong post", await call("PATCH", `/posts/${L}/comments/${c.json.id}`, bob.token, { body: "x" }), 404);
r = await call("PATCH", C, bob.token, { body: "Bob edited" });
expect("edit comment", r, 200);
check("edited comment body", r.json?.body === "Bob edited", r.json);
check("edited comment updatedAt > createdAt", new Date(r.json?.updatedAt) > new Date(r.json?.createdAt), r.json && [r.json.createdAt, r.json.updatedAt]);
expect("like comment", await call("PUT", `${C}/like`, carol.token), 200);

expect("delete comment non-author", await call("DELETE", C, alice.token), 403);
expect("delete comment", await call("DELETE", C, bob.token), 204);
expect("delete again", await call("DELETE", C, bob.token), 404);
expect("edit deleted comment", await call("PATCH", C, bob.token, { body: "zombie" }), 404);
expect("reply to deleted comment", await call("POST", `/posts/${P}/comments`, carol.token, { body: "x", parentId: c.json.id }), 404);
expect("like deleted comment", await call("PUT", `${C}/like`, carol.token), 404);
r = await call("GET", `/posts/${P}/comments`);
const root = r.json?.find?.((t: any) => t.id === c.json.id);
check("deleted comment stays in thread", !!root, r.json);
check("deleted comment body null", root?.body === null, root);
check("reply still nested under deleted comment", root?.replies?.[0]?.id === reply.json.id, root?.replies);
check("deleted comment exposes deletedAt", root && root.deletedAt != null, root);

// ---------- Feeds ----------
console.log("\n== Feeds");
// c2 posts by bob, an extra post by erin in c2 that nobody relevant should see via c2 membership
const bobPost = await call("POST", "/posts", bob.token, { communityId: c2.id, postType: "text", title: "Bob in c2", body: "b" });
const erinPost = await call("POST", "/posts", erin.token, { communityId: c2.id, postType: "text", title: "Erin in c2", body: "e" });
const ids = (j: any) => (j?.posts ?? []).map((p: any) => p.publicId);

expect("home feed no auth", await call("GET", "/posts/feed"), 401);
r = await call("GET", "/posts/feed", alice.token);
expect("alice feed", r, 200);
check("feed shape {posts,nextCursor}", Array.isArray(r.json?.posts) && "nextCursor" in r.json, r.json);
check("alice sees own posts", ids(r.json).includes(P) && ids(r.json).includes(L), ids(r.json));
check("alice doesn't see unrelated c2 posts", !ids(r.json).includes(erinPost.json.publicId), ids(r.json));
r = await call("GET", "/posts/feed", carol.token);
check("carol (c1 member) sees c1 posts", ids(r.json).includes(P), ids(r.json));
check("carol doesn't see c2", !ids(r.json).includes(bobPost.json.publicId), ids(r.json));
r = await call("GET", "/posts/feed", dave.token);
check("dave (follows bob) sees bob's post", ids(r.json).includes(bobPost.json.publicId), ids(r.json));
check("dave doesn't see erin's post", !ids(r.json).includes(erinPost.json.publicId), ids(r.json));
r = await call("GET", "/posts/feed", erin.token);
check("erin feed only own", JSON.stringify(ids(r.json)) === JSON.stringify([erinPost.json.publicId]), ids(r.json));

r = await call("GET", `/communities/${c1.id}/posts`);
expect("community feed (no auth needed)", r, 200);
const c1Ids = ids(r.json);
check("community feed newest first", c1Ids[0] === L && c1Ids[1] === P, c1Ids);
check("community feed nextCursor null when not full", r.json?.nextCursor === null, r.json?.nextCursor);

// paging through c1 one at a time must visit every post exactly once
const seen: string[] = [];
let cursor: string | null = null;
for (let i = 0; i < 10; i++) {
  const page: any = await call("GET", `/communities/${c1.id}/posts?limit=1${cursor ? `&cursor=${cursor}` : ""}`);
  if (page.status !== 200) { check("paging status", false, page); break; }
  seen.push(...ids(page.json));
  cursor = page.json.nextCursor;
  if (!cursor) break;
}
check("limit=1 paging visits all posts once, in order", JSON.stringify(seen) === JSON.stringify(c1Ids), { seen, c1Ids });
r = await call("GET", `/communities/${c1.id}/posts?limit=${c1Ids.length}`);
check("exactly-full last page still gives a cursor (documented behavior)", r.json?.nextCursor !== null, r.json?.nextCursor);
r = await call("GET", `/communities/${c1.id}/posts?cursor=${r.json?.nextCursor}`);
check("following that cursor yields empty page + null cursor", r.status === 200 && r.json.posts.length === 0 && r.json.nextCursor === null, r.json);

expect("limit=0", await call("GET", `/communities/${c1.id}/posts?limit=0`), 400);
expect("limit=101", await call("GET", `/communities/${c1.id}/posts?limit=101`), 400);
expect("limit=abc", await call("GET", `/communities/${c1.id}/posts?limit=abc`), 400);
expect("limit=2.5", await call("GET", `/communities/${c1.id}/posts?limit=2.5`), 400);
expect("limit=100 ok", await call("GET", `/communities/${c1.id}/posts?limit=100`), 200);
expect("bad cursor", await call("GET", `/communities/${c1.id}/posts?cursor=garbage`), 400);
expect("repeated cursor param", await call("GET", `/communities/${c1.id}/posts?cursor=a&cursor=b`), 400);
expect("bad cursor on home feed", await call("GET", `/posts/feed?cursor=garbage`, alice.token), 400);
expect("malformed community id", await call("GET", `/communities/not-a-uuid/posts`), 404);
expect("unknown community id", await call("GET", `/communities/00000000-0000-4000-8000-000000000000/posts`), 404);

// ---------- Delete post ----------
console.log("\n== DELETE /api/posts/:postId");
expect("delete no auth", await call("DELETE", `/posts/${L}`), 401);
expect("delete non-author", await call("DELETE", `/posts/${L}`, bob.token), 403);
expect("delete", await call("DELETE", `/posts/${L}`, alice.token), 204);
expect("GET deleted post", await call("GET", `/posts/${L}`), 404);
expect("delete again", await call("DELETE", `/posts/${L}`, alice.token), 404);
expect("edit deleted post", await call("PATCH", `/posts/${L}`, alice.token, { title: "x" }), 404);
expect("comment on deleted post", await call("POST", `/posts/${L}/comments`, bob.token, { body: "x" }), 404);
r = await call("GET", `/communities/${c1.id}/posts`);
check("deleted post gone from community feed", !ids(r.json).includes(L), ids(r.json));
r = await call("GET", "/posts/feed", carol.token);
check("deleted post gone from home feed", !ids(r.json).includes(L), ids(r.json));

console.log(`\n${pass} passed, ${failures.length} failed`);
for (const f of failures) console.log(`  FAIL ${f}`);
console.log(`\nDemo data: community c1=${c1.id} c2=${c2.id}; users *_${run} / correct-horse-battery`);
await closeDatabase();
process.exitCode = failures.length ? 1 : 0;
