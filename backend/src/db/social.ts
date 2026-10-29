import { prisma } from "./client.js";

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

export async function setPostLiked(postId: string, userId: string, liked: boolean): Promise<void> {
  if (liked) {
    await prisma.postLike.upsert({
      where: { postId_userId: { postId, userId } },
      create: { postId, userId },
      update: {},
    });
  } else {
    await prisma.postLike.deleteMany({ where: { postId, userId } });
  }
}

export async function getPostLikeSummary(postId: string, userId: string) {
  const [likeCount, viewerLike] = await prisma.$transaction([
    prisma.postLike.count({ where: { postId } }),
    prisma.postLike.findUnique({
      where: { postId_userId: { postId, userId } },
      select: { postId: true },
    }),
  ]);
  return { liked: viewerLike !== null, likeCount };
}

export async function setCommentLiked(
  commentId: string,
  userId: string,
  liked: boolean,
): Promise<void> {
  if (liked) {
    await prisma.commentLike.upsert({
      where: { commentId_userId: { commentId, userId } },
      create: { commentId, userId },
      update: {},
    });
  } else {
    await prisma.commentLike.deleteMany({ where: { commentId, userId } });
  }
}
