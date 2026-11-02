import assert from "node:assert/strict";
import { test } from "node:test";

// postService imports the database client, which needs a URL to load. These tests never query it.
process.env.DATABASE_URL ??= "postgresql://unused@localhost/unused";
const { decodeCursor, encodeCursor, isUuid, postPage, validatePostContent } = await import(
  "../src/services/postService.js"
);

const content = { title: "Hello", body: null, externalUrl: null };

test("post content follows the rules for its type", () => {
  assert.equal(validatePostContent("text", { ...content, body: "Hi" }), null);
  assert.equal(validatePostContent("text", content), "Text posts require a body");
  assert.equal(
    validatePostContent("text", { ...content, body: "Hi", externalUrl: "https://example.com" }),
    "Text posts can't have an externalUrl",
  );

  assert.equal(validatePostContent("link", { ...content, externalUrl: "https://example.com" }), null);
  assert.equal(validatePostContent("link", content), "Link posts require an externalUrl");
  assert.equal(
    validatePostContent("link", { ...content, externalUrl: "javascript:alert(1)" }),
    "externalUrl must be an http or https URL",
  );

  assert.equal(validatePostContent("media", content), null);
  assert.match(validatePostContent("media", { ...content, title: "   " }) ?? "", /^title must be/);
  assert.match(validatePostContent("media", { ...content, title: "x".repeat(301) }) ?? "", /^title must be/);
});

test("feed cursors round-trip and reject tampering", () => {
  const post = { createdAt: new Date("2026-10-31T12:00:00.000Z"), id: "6f1c2a4e-1b2c-4d3e-8f90-123456789abc" };
  assert.deepEqual(decodeCursor(encodeCursor(post)), post);

  assert.equal(decodeCursor("not-a-cursor"), null);
  assert.equal(decodeCursor(Buffer.from(JSON.stringify(["2026-10-31", "not-a-uuid"])).toString("base64url")), null);
  assert.equal(decodeCursor(Buffer.from(JSON.stringify(["yesterday", post.id])).toString("base64url")), null);
});

test("a page gets a nextCursor only when it's full", () => {
  const posts = [
    { createdAt: new Date("2026-10-31T12:00:00.000Z"), id: "6f1c2a4e-1b2c-4d3e-8f90-123456789abc" },
    { createdAt: new Date("2026-10-30T12:00:00.000Z"), id: "7f1c2a4e-1b2c-4d3e-8f90-123456789abc" },
  ];
  assert.equal(postPage(posts, 2).nextCursor, encodeCursor(posts[1]!));
  assert.equal(postPage(posts, 3).nextCursor, null);
  assert.equal(postPage([], 20).nextCursor, null);
});

test("isUuid accepts only well-formed UUIDs", () => {
  assert.equal(isUuid("6f1c2a4e-1b2c-4d3e-8f90-123456789abc"), true);
  assert.equal(isUuid("6f1c2a4e"), false);
  assert.equal(isUuid(42), false);
  assert.equal(isUuid(undefined), false);
});
