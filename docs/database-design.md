# Database design

The ERD is in [erd.md](erd.md) (Mermaid source) and [swe_erd_v2.pdf](swe_erd_v2.pdf) (rendered). Both come from [schema.prisma](../backend/prisma/schema.prisma) and the migrations. The PDF is from before version 0.2.0 and still shows likes; erd.md is up to date.

## How to read the ERD

- Each box is a table. Each row shows the type, the column name, the key, and a note.
- **PK** is the primary key. **FK** points to a row in another table. **UK** must be unique.
- The notes show limits and rules, for example `max 32` or `CASCADE` (the row is deleted with its parent).
- The line ends show how many rows connect: `||` is exactly one, `o|` is zero or one, and `o{` is zero or more. For example, `users ||--o{ posts` means one user writes zero or more posts.

## The main parts

- **Accounts:** `users` and `sessions`. A session is one login on one device.
- **Communities:** `communities` and `community_memberships`.
- **Content:** `posts` and `comments`. A post belongs to one community and one author.
- **Social:** `user_follows`, `post_votes` and `comment_votes`.
- **Media:** `media_objects` and `post_media`. The file is in object storage (SeaweedFS). The table keeps the bucket, key, size and status.

## Design decisions

**UUIDs as internal keys.** The app makes each `id` with `randomUUID()`. Thus, IDs do not show how many rows exist, and nobody can guess the next ID.

**`public_id` for posts.** A UUID is too long for a URL. Each post also has a 12-character Crockford base32 ID, for example `/api/posts/R14SZSWA4B69`.
- Crockford base32 has no I, L, O or U, so people do not confuse letters with numbers.
- 12 characters give 60 bits. A collision is almost  impossible. The unique index and a retry in `createPost` catch one if it occurs.
- We added a column instead of a change to the primary key. All foreign keys stay `uuid`, so no other table changes.

**Comment threads with `parent_id` and `depth`.** `parent_id` points to the comment that a reply answers. It is null for a comment on the post.
- `depth` is 0 for a comment on the post, and the parent's depth plus 1 for a reply. With it, the app can indent replies or set a maximum depth without a walk up the parent chain.
- The foreign key on `(parent_id, post_id)` makes sure that a reply is on the same post as its parent.
- The API reads the comments in one query and uses `parent_id` to send them as a tree.

**Soft deletes.** `users`, `posts` and `comments` have `deleted_at`. A delete sets this date. For posts and comments, it also removes the text. The row stays, so replies and votes do not lose their link. A deleted comment shows as `[deleted]` in its thread.

**Composite keys for join tables.** `post_votes`, `comment_votes`, `community_memberships` and `user_follows` use two columns as the primary key. Thus, a user can vote on a post only one time. `user_follows` also stops a user from following themselves.

**Votes and scores.** A row in `post_votes` or `comment_votes` has a `value` of 1 (upvote) or -1 (downvote). A check constraint allows no other value. A user changes a vote by changing `value`, and removes it by deleting the row.
- `posts.score` and `comments.score` are the total of the votes. Triggers update them when a vote is added, changed or removed, so a feed can show and sort by score without a count of the votes.
- The app reads `score` but does not write it.
- These tables were `post_likes` and `comment_likes` before version 0.2.0. The `votes` migration renamed them and turned every like into an upvote.

**Uploads in two steps.** A `media_objects` row starts as `pending` when the upload starts. It changes to `ready` when the upload is complete. Only `ready` media can be attached to a post. `media_id` is unique in `post_media`, so each file belongs to only one post.
- Before a file becomes `ready`, the API checks its contents and saves `width`, `height` and `duration_seconds`. A file that fails the check becomes `failed`.
- When a post is deleted, its media rows and files are deleted.
- A cleanup job deletes uploads that never become `ready`, and `ready` uploads that are never put on a post.
