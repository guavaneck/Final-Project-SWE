// Creates a demo user and community for trying the API by hand.
// Safe to run more than once: it reuses the existing rows and prints their IDs.

import { closeDatabase, createCommunity, createUser, prisma } from "../src/db/index.js";

const user =
  (await prisma.user.findUnique({ where: { username: "demo" }, select: { id: true } })) ??
  (await createUser({
    username: "demo",
    email: "demo@example.com",
    passwordHash: "not-a-real-hash",
    displayName: "Demo User",
  }));

const community =
  (await prisma.community.findUnique({ where: { slug: "demo" }, select: { id: true } })) ??
  (await createCommunity({ creatorId: user.id, slug: "demo", name: "Demo Community" }));

console.log(`User ID:      ${user.id}`);
console.log(`Community ID: ${community.id}`);

await closeDatabase();
