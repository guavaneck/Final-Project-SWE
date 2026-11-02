import { prisma } from "./client.js";

export type VoteValue = -1 | 0 | 1;

export async function followUser(followerId: string, followedId: string): Promise<void> {
  await prisma.userFollow.upsert({
    where: { followerId_followedId: { followerId, followedId } },
    create: { followerId, followedId },
    update: {},
  });
}

export async function unfollowUser(followerId: string, followedId: string): Promise<boolean> {
  const result = await prisma.userFollow.deleteMany({ where: { followerId, followedId } });
  return result.count === 1;
}

// 0 removes the user's vote.
export async function setPostVote(postId: string, userId: string, value: VoteValue): Promise<void> {
  if (value === 0) {
    await prisma.postVote.deleteMany({ where: { postId, userId } });
  } else {
    await prisma.postVote.upsert({
      where: { postId_userId: { postId, userId } },
      create: { postId, userId, value },
      update: { value },
    });
  }
}

export async function getPostVoteSummary(postId: string, userId: string) {
  const [post, vote] = await prisma.$transaction([
    prisma.post.findUniqueOrThrow({ where: { id: postId }, select: { score: true } }),
    prisma.postVote.findUnique({
      where: { postId_userId: { postId, userId } },
      select: { value: true },
    }),
  ]);
  return { score: post.score, viewerVote: vote?.value ?? 0 };
}

export async function getPostVotes(userId: string, postIds: string[]): Promise<Map<string, number>> {
  const votes = await prisma.postVote.findMany({
    where: { userId, postId: { in: postIds } },
    select: { postId: true, value: true },
  });
  return new Map(votes.map((v) => [v.postId, v.value]));
}

export async function setCommentVote(
  commentId: string,
  userId: string,
  value: VoteValue,
): Promise<void> {
  if (value === 0) {
    await prisma.commentVote.deleteMany({ where: { commentId, userId } });
  } else {
    await prisma.commentVote.upsert({
      where: { commentId_userId: { commentId, userId } },
      create: { commentId, userId, value },
      update: { value },
    });
  }
}

export async function getCommentVoteSummary(commentId: string, userId: string) {
  const [comment, vote] = await prisma.$transaction([
    prisma.comment.findUniqueOrThrow({ where: { id: commentId }, select: { score: true } }),
    prisma.commentVote.findUnique({
      where: { commentId_userId: { commentId, userId } },
      select: { value: true },
    }),
  ]);
  return { score: comment.score, viewerVote: vote?.value ?? 0 };
}

export async function getCommentVotes(
  userId: string,
  commentIds: string[],
): Promise<Map<string, number>> {
  const votes = await prisma.commentVote.findMany({
    where: { userId, commentId: { in: commentIds } },
    select: { commentId: true, value: true },
  });
  return new Map(votes.map((v) => [v.commentId, v.value]));
}
