import { randomUUID } from "node:crypto";
import { prisma } from "./client.js";

export type AnalyticsRange = 7 | 30 | 90;

function utcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export async function recordPostView(postId: string, viewerId: string, at = new Date()) {
  const post = await prisma.post.findFirst({ where: { id: postId, deletedAt: null }, select: { authorId: true } });
  if (!post || post.authorId === viewerId) return false;
  const result = await prisma.postView.createMany({
    data: [{ id: randomUUID(), postId, viewerId, viewedDay: utcDay(at), createdAt: at }],
    skipDuplicates: true,
  });
  return result.count === 1;
}

export async function recordPostShare(postId: string, userId: string, at = new Date()) {
  const post = await prisma.post.findFirst({ where: { id: postId, deletedAt: null }, select: { id: true } });
  if (!post) return false;
  await prisma.postShare.create({ data: { id: randomUUID(), postId, userId, createdAt: at } });
  return true;
}

export async function creatorAnalytics(authorId: string, range: AnalyticsRange, now = new Date()) {
  const endDay = utcDay(now);
  const start = new Date(endDay);
  start.setUTCDate(start.getUTCDate() - range + 1);
  const end = new Date(endDay);
  end.setUTCDate(end.getUTCDate() + 1);

  const posts = await prisma.post.findMany({
    where: { authorId, deletedAt: null },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: {
      id: true, publicId: true, title: true, createdAt: true, score: true,
      community: { select: { slug: true } },
      votes: { select: { value: true } },
      views: { where: { createdAt: { gte: start, lt: end } }, select: { createdAt: true } },
      shares: { where: { createdAt: { gte: start, lt: end } }, select: { createdAt: true } },
      voteEvents: { where: { createdAt: { lt: end } }, orderBy: { createdAt: "asc" }, select: { oldValue: true, newValue: true, createdAt: true } },
    },
  });

  const days = Array.from({ length: range }, (_, offset) => {
    const date = new Date(start);
    date.setUTCDate(date.getUTCDate() + offset);
    return date.toISOString().slice(0, 10);
  });

  const resultPosts = posts.map((post) => {
    let upvotes = 0;
    let downvotes = 0;
    const series = days.map((date) => ({ date, upvotes: 0, downvotes: 0, views: 0, shares: 0 }));
    const byDay = new Map(series.map((point) => [point.date, point]));
    for (const event of post.voteEvents) {
      if (event.createdAt < start) {
        if (event.oldValue === 1) upvotes--;
        if (event.oldValue === -1) downvotes--;
        if (event.newValue === 1) upvotes++;
        if (event.newValue === -1) downvotes++;
      }
    }
    for (const point of series) {
      for (const event of post.voteEvents) {
        if (event.createdAt.toISOString().slice(0, 10) !== point.date) continue;
        if (event.oldValue === 1) upvotes--;
        if (event.oldValue === -1) downvotes--;
        if (event.newValue === 1) upvotes++;
        if (event.newValue === -1) downvotes++;
      }
      point.upvotes = upvotes;
      point.downvotes = downvotes;
    }
    for (const view of post.views) byDay.get(view.createdAt.toISOString().slice(0, 10))!.views++;
    for (const share of post.shares) byDay.get(share.createdAt.toISOString().slice(0, 10))!.shares++;
    const currentUpvotes = post.votes.filter((vote) => vote.value === 1).length;
    const currentDownvotes = post.votes.filter((vote) => vote.value === -1).length;
    return {
      id: post.publicId,
      title: post.title,
      community: post.community.slug,
      createdAt: post.createdAt,
      views: post.views.length,
      shares: post.shares.length,
      upvotes: currentUpvotes,
      downvotes: currentDownvotes,
      score: post.score,
      series,
    };
  });

  return {
    range: `${range}d`,
    start: start.toISOString(),
    end: now.toISOString(),
    totals: resultPosts.reduce((totals, post) => ({
      views: totals.views + post.views,
      shares: totals.shares + post.shares,
      upvotes: totals.upvotes + post.upvotes,
      downvotes: totals.downvotes + post.downvotes,
      score: totals.score + post.score,
    }), { views: 0, shares: 0, upvotes: 0, downvotes: 0, score: 0 }),
    posts: resultPosts,
  };
}
