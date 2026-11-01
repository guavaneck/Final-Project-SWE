import assert from "node:assert/strict";
import { after, test } from "node:test";
import {
  closeDatabase,
  createComment,
  createCommunity,
  createPost,
  createUser,
  deleteComment,
  deletePost,
  followUser,
  getPostLikeSummary,
  getPostById,
  getPostByPublicId,
  getCommentLikeSummary,
  joinCommunity,
  listCommunityPosts,
  listHomeFeed,
  prisma,
  setPostLiked,
  setCommentLiked,
  updateComment,
  updatePost,
} from "../src/db/index.js";

const createdUserIds: string[] = [];
const createdCommunityIds: string[] = [];

after(async () => {
  await prisma.post.deleteMany({ where: { communityId: { in: createdCommunityIds } } });
  await prisma.community.deleteMany({ where: { id: { in: createdCommunityIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await closeDatabase();
});

test("core social database functions", async () => {
  const suffix = Date.now().toString();
  const alice = await createUser({
    username: `alice_${suffix}`,
    email: `alice_${suffix}@example.com`,
    passwordHash: "test-hash",
    displayName: "Alice",
  });
  const bob = await createUser({
    username: `bob_${suffix}`,
    email: `bob_${suffix}@example.com`,
    passwordHash: "test-hash",
    displayName: "Bob",
  });
  createdUserIds.push(alice.id, bob.id);

  const community = await createCommunity({
    creatorId: alice.id,
    slug: `general-${suffix}`,
    name: "General",
  });
  createdCommunityIds.push(community.id);

  await joinCommunity(community.id, bob.id);
  await followUser(bob.id, alice.id);

  const post = await createPost({
    authorId: alice.id,
    communityId: community.id,
    postType: "text",
    title: "Hello",
    body: "First post",
  });
  assert.match(post.publicId, /^[0-9A-HJKMNP-TV-Z]{12}$/);
  assert.equal((await getPostByPublicId(post.publicId))?.id, post.id);

  const comment = await createComment(post.id, bob.id, "First reply");
  assert.equal(comment?.depth, 0);
  assert.ok(comment);
  await setCommentLiked(comment.id, alice.id, true);
  assert.deepEqual(await getCommentLikeSummary(comment.id, alice.id), {
    liked: true,
    likeCount: 1,
  });
  await setCommentLiked(comment.id, alice.id, false);
  assert.deepEqual(await getCommentLikeSummary(comment.id, alice.id), {
    liked: false,
    likeCount: 0,
  });
  const reply = await createComment(post.id, alice.id, "Reply to reply", comment?.id);
  assert.equal(reply?.depth, 1);
  assert.ok(reply);

  assert.equal(await updateComment(reply.id, bob.id, "Not mine"), null);
  assert.equal((await updateComment(reply.id, alice.id, "Edited reply"))?.body, "Edited reply");
  assert.equal(await deleteComment(reply.id, bob.id), false);
  assert.equal(await deleteComment(reply.id, alice.id), true);
  assert.equal(await updateComment(reply.id, alice.id, "Too late"), null);
  assert.equal(await createComment(post.id, bob.id, "Reply to deleted", reply.id), null);

  assert.equal(await updatePost(post.id, bob.id, { title: "Not mine" }), null);
  const edited = await updatePost(post.id, alice.id, { body: "Edited body" });
  assert.equal(edited?.title, "Hello");
  assert.equal(edited?.body, "Edited body");

  const second = await createPost({
    authorId: bob.id,
    communityId: community.id,
    postType: "link",
    title: "A link",
    externalUrl: "https://example.com",
  });
  const firstPage = await listCommunityPosts(community.id, 1);
  assert.deepEqual(firstPage.map((p) => p.id), [second.id]);
  const secondPage = await listCommunityPosts(community.id, 1, firstPage[0]);
  assert.deepEqual(secondPage.map((p) => p.id), [post.id]);
  await deletePost(second.id, bob.id);

  await setPostLiked(post.id, bob.id, true);
  assert.deepEqual(await getPostLikeSummary(post.id, bob.id), { liked: true, likeCount: 1 });
  await setPostLiked(post.id, bob.id, false);
  assert.deepEqual(await getPostLikeSummary(post.id, bob.id), { liked: false, likeCount: 0 });
  await setPostLiked(post.id, bob.id, true);

  const feed = await listHomeFeed(bob.id);
  assert.equal(feed[0]?.id, post.id);
  assert.equal(await deletePost(post.id, bob.id), false);
  assert.equal(await deletePost(post.id, alice.id), true);
  assert.equal(await getPostById(post.id), null);
});
