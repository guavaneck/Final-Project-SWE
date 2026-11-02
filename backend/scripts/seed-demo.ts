// Creates a demo user and community for trying the API by hand.
// Safe to run more than once: it reuses the existing rows and prints their IDs.

import { closeDatabase, createCommunity, createUser, prisma } from "../src/db/index.js";
import { hashPassword } from "../src/auth/password.js";

const demoPasswordHash = await hashPassword("demo-password");

const user =
  (await prisma.user.findUnique({ where: { username: "demo" }, select: { id: true } })) ??
  (await createUser({
    username: "demo",
    email: "demo@example.com",
    passwordHash: demoPasswordHash,
    displayName: "Demo User",
  }));

await prisma.user.update({ where: { id: user.id }, data: { passwordHash: demoPasswordHash } });

const community =
  (await prisma.community.findUnique({ where: { slug: "demo" }, select: { id: true } })) ??
  (await createCommunity({ creatorId: user.id, slug: "demo", name: "Demo Community" }));

console.log(`User ID:      ${user.id}`);
console.log(`Community ID: ${community.id}`);
console.log("Login:        demo / demo-password");

await closeDatabase();
