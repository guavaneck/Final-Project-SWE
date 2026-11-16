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
  getPostVoteSummary,
  getPostVotes,
  getPostById,
  getPostByPublicId,
  getCommentVoteSummary,
  joinCommunity,
  listCommunityPosts,
  listHomeFeed,
  prisma,
  setPostVote,
  setCommentVote,
  updateComment,
  updatePost,
  creatorAnalytics,
  recordPostView,
  recordPostShare,
  addModerator,
  banUser,
  isBanned,
  isModerator,
  listBans,
  listModerators,
  listPinnedPosts,
  MAX_PINNED_POSTS,
  pinPost,
  removeModerator,
  unbanUser,
  unpinPost,
  updateCommunity,
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
  await setCommentVote(comment.id, alice.id, 1);
  assert.deepEqual(await getCommentVoteSummary(comment.id, alice.id), { score: 1, viewerVote: 1 });
  await setCommentVote(comment.id, bob.id, -1);
  await setCommentVote(comment.id, alice.id, -1);
  assert.deepEqual(await getCommentVoteSummary(comment.id, alice.id), { score: -2, viewerVote: -1 });
  await setCommentVote(comment.id, alice.id, 0);
  await setCommentVote(comment.id, bob.id, 0);
  assert.deepEqual(await getCommentVoteSummary(comment.id, alice.id), { score: 0, viewerVote: 0 });
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

  await setPostVote(post.id, bob.id, 1);
  await setPostVote(post.id, bob.id, 1);
  assert.deepEqual(await getPostVoteSummary(post.id, bob.id), { score: 1, viewerVote: 1 });
  await setPostVote(post.id, alice.id, -1);
  assert.deepEqual(await getPostVoteSummary(post.id, alice.id), { score: 0, viewerVote: -1 });
  await setPostVote(post.id, alice.id, 0);
  assert.deepEqual(await getPostVoteSummary(post.id, alice.id), { score: 1, viewerVote: 0 });
  assert.deepEqual(await getPostVotes(bob.id, [post.id]), new Map([[post.id, 1]]));

  assert.equal(await recordPostView(post.id, alice.id), false, "authors do not count as their own views");
  assert.equal(await recordPostView(post.id, bob.id), true);
  assert.equal(await recordPostView(post.id, bob.id), false, "a viewer counts once per UTC day");
  assert.equal(await recordPostShare(post.id, bob.id), true);
  const analytics = await creatorAnalytics(alice.id, 7);
  const postAnalytics = analytics.posts.find((item) => item.id === post.publicId);
  assert.equal(postAnalytics?.views, 1);
  assert.equal(postAnalytics?.shares, 1);
  assert.equal(postAnalytics?.upvotes, 1);
  assert.equal(postAnalytics?.downvotes, 0);
  assert.equal(postAnalytics?.series.length, 7);

  const feed = await listHomeFeed(bob.id);
  assert.equal(feed[0]?.id, post.id);
  assert.equal(await deletePost(post.id, bob.id), false);
  assert.equal(await deletePost(post.id, alice.id), true);
  assert.equal(await getPostById(post.id), null);
});

test("community moderation", async () => {
  const suffix = `${Date.now()}`;
  const [mod, member, other] = await Promise.all(
    ["mod", "member", "other"].map((name) =>
      createUser({
        username: `${name}_${suffix}`,
        email: `${name}_${suffix}@example.com`,
        passwordHash: "test-hash",
        displayName: name,
      }),
    ),
  );
  createdUserIds.push(mod!.id, member!.id, other!.id);

  const community = await createCommunity({ creatorId: mod!.id, slug: `modded-${suffix}`, name: "Modded" });
  createdCommunityIds.push(community.id);

  // The creator is the first moderator, and the last moderator can't be removed.
  assert.equal(await isModerator(community.id, mod!.id), true);
  assert.equal(await isModerator(community.id, member!.id), false);
  assert.equal(await removeModerator(community.id, mod!.id), "last");
  assert.equal(await removeModerator(community.id, member!.id), "missing");

  await addModerator(community.id, other!.id, mod!.id);
  assert.deepEqual((await listModerators(community.id)).map((m) => m.user.id), [mod!.id, other!.id]);
  assert.equal(await removeModerator(community.id, other!.id), "removed");

  const edited = await updateCommunity(community.id, { name: "Renamed", description: "About" });
  assert.equal(edited.name, "Renamed");
  assert.equal((await updateCommunity(community.id, { description: null })).description, null);

  // Moderators can delete anyone's post or comment (authorId null skips the author check).
  const post = await createPost({
    authorId: member!.id,
    communityId: community.id,
    postType: "text",
    title: "Member post",
    body: "Hi",
  });
  const comment = await createComment(post.id, member!.id, "Member comment");
  assert.ok(comment);
  assert.equal(await deleteComment(comment.id, null), true);

  // Pins are limited, and deleting a post unpins it.
  const extra = await Promise.all(
    Array.from({ length: MAX_PINNED_POSTS }, (_, i) =>
      createPost({ authorId: mod!.id, communityId: community.id, postType: "text", title: `Pin ${i}`, body: "x" }),
    ),
  );
  for (const pinned of extra) assert.equal(await pinPost(pinned.id, community.id), true);
  assert.equal(await pinPost(extra[0]!.id, community.id), true, "re-pinning a pinned post is fine");
  assert.equal(await pinPost(post.id, community.id), false, "over the limit");
  await unpinPost(extra[0]!.id);
  assert.equal(await pinPost(post.id, community.id), true);
  assert.equal(await deletePost(post.id, null), true);
  assert.deepEqual(
    (await listPinnedPosts(community.id)).map((p) => p.id).sort(),
    [extra[1]!.id, extra[2]!.id].sort(),
  );

  // Banning removes membership; unbanning lifts the ban.
  await joinCommunity(community.id, member!.id);
  await banUser(community.id, member!.id, mod!.id, "Spam");
  assert.equal(await isBanned(community.id, member!.id), true);
  assert.equal(
    await prisma.communityMembership.count({ where: { communityId: community.id, userId: member!.id } }),
    0,
  );
  assert.deepEqual(
    (await listBans(community.id)).map((ban) => [ban.user.id, ban.reason, ban.bannedBy?.id]),
    [[member!.id, "Spam", mod!.id]],
  );
  assert.equal(await unbanUser(community.id, member!.id), true);
  assert.equal(await unbanUser(community.id, member!.id), false);
  assert.equal(await isBanned(community.id, member!.id), false);
});
