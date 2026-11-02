import assert from "node:assert/strict";
import { test } from "node:test";
import { hashPassword, verifyPassword } from "../src/auth/password.js";
import { createSessionToken, hashSessionToken } from "../src/auth/session.js";

test("passwords are salted, hashed, and verified", async () => {
  const first = await hashPassword("correct horse battery staple");
  const second = await hashPassword("correct horse battery staple");

  assert.notEqual(first, second);
  assert.equal(await verifyPassword("correct horse battery staple", first), true);
  assert.equal(await verifyPassword("wrong password", first), false);
  assert.equal(await verifyPassword("anything", "not-a-valid-hash"), false);
});

test("session tokens are random and stored only as deterministic hashes", () => {
  const first = createSessionToken();
  const second = createSessionToken();

  assert.notEqual(first, second);
  assert.match(first, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(hashSessionToken(first), hashSessionToken(first));
  assert.notEqual(hashSessionToken(first), first);
  assert.notEqual(hashSessionToken(first), hashSessionToken(second));
});
