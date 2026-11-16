// Creates an idempotent analytics demo. Every account uses password 1234.
import { randomUUID } from "node:crypto";
import { closeDatabase, createCommunity, createPost, createUser, prisma } from "../src/db/index.js";
import { hashPassword } from "../src/auth/password.js";

const passwordHash = await hashPassword("1234");
const accounts = [
  ["creator_demo", "Creator Demo"], ["viewer_alex", "Alex Rivera"],
  ["viewer_bailey", "Bailey Chen"], ["viewer_casey", "Casey Morgan"],
  ["viewer_drew", "Drew Patel"], ["viewer_erin", "Erin Brooks"],
  ["viewer_frankie", "Frankie Kim"],
] as const;

const users = new Map<string, { id: string }>();
for (const [username, displayName] of accounts) {
  const email = `${username}@example.com`;
  const user = (await prisma.user.findUnique({ where: { username }, select: { id: true } })) ??
    await createUser({ username, email, displayName, passwordHash });
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash, displayName } });
  users.set(username, user);
}

const creator = users.get("creator_demo")!;
const community = (await prisma.community.findUnique({ where: { slug: "creator-lab" }, select: { id: true } })) ??
  await createCommunity({ creatorId: creator.id, slug: "creator-lab", name: "Creator Lab", description: "Demo creator content and analytics" });

const oldDemoPosts = await prisma.post.findMany({ where: {
  authorId: creator.id, title: { startsWith: "[Analytics demo]" },
}, select: { id: true } });
if (oldDemoPosts.length) await prisma.post.deleteMany({ where: { id: { in: oldDemoPosts.map((post) => post.id) } } });

const ago = (days: number, hour = 15) => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  date.setUTCHours(hour, 0, 0, 0);
  return date;
};
const postInputs = [
  { title: "[Analytics demo] How I plan a weekly project", body: "A practical planning workflow for small creative projects.", daysAgo: 25 },
  { title: "[Analytics demo] Behind the scenes of my latest build", body: "Notes, mistakes, and lessons from the build process.", daysAgo: 15 },
  { title: "[Analytics demo] Five shortcuts worth learning", body: "Five small techniques that save time every week.", daysAgo: 6 },
];
const posts = [];
for (const input of postInputs) {
  const post = await createPost({ authorId: creator.id, communityId: community.id, postType: "text", title: input.title, body: input.body });
  await prisma.post.update({ where: { id: post.id }, data: { createdAt: ago(input.daysAgo), updatedAt: ago(input.daysAgo) } });
  posts.push(post);
}

const viewers = [...users.entries()].filter(([name]) => name !== "creator_demo").map(([, user]) => user);
for (let postIndex = 0; postIndex < posts.length; postIndex++) {
  const post = posts[postIndex]!;
  const activeDays = postInputs[postIndex]!.daysAgo;
  for (let day = Math.min(activeDays, 29); day >= 0; day--) {
    const dailyViewers = viewers.slice(0, 2 + ((day + postIndex) % 5));
    for (const viewer of dailyViewers) {
      const createdAt = ago(day, 12 + (viewers.indexOf(viewer) % 6));
      await prisma.postView.create({ data: {
        id: randomUUID(), postId: post.id, viewerId: viewer.id,
        viewedDay: new Date(createdAt.toISOString().slice(0, 10)), createdAt,
      }});
    }
    if ((day + postIndex) % 3 === 0) {
      await prisma.postShare.create({ data: {
        id: randomUUID(), postId: post.id, userId: viewers[(day + postIndex) % viewers.length]!.id, createdAt: ago(day, 18),
      }});
    }
  }
  for (let index = 0; index < viewers.length; index++) {
    const viewer = viewers[index]!;
    const value = (index + postIndex) % 4 === 0 ? -1 : 1;
    const createdAt = ago(Math.max(0, activeDays - 2 - index * 2), 19);
    await prisma.postVote.create({ data: { postId: post.id, userId: viewer.id, value, createdAt } });
    await prisma.postVoteEvent.create({ data: {
      id: randomUUID(), postId: post.id, userId: viewer.id, oldValue: 0, newValue: value, createdAt,
    }});
  }
}

console.log("Analytics demo ready");
console.log("Creator login: creator_demo / 1234");
console.log("Viewer logins: viewer_alex through viewer_frankie / 1234");
console.log("Page: http://localhost:3000/analytics");
await closeDatabase();
