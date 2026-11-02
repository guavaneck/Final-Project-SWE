# Database design

The ERD is in [erd.md](erd.md) (Mermaid source) and [swe_erd_v2.pdf](swe_erd_v2.pdf) (rendered). Both come from [schema.prisma](../backend/prisma/schema.prisma) and the migrations.

## How to read the ERD

- Each box is a table. Each row shows the type, the column name, the key, and a note.
- **PK** is the primary key. **FK** points to a row in another table. **UK** must be unique.
- The notes show limits and rules, for example `max 32` or `CASCADE` (the row is deleted with its parent).
- The line ends show how many rows connect: `||` is exactly one, `o|` is zero or one, and `o{` is zero or more. For example, `users ||--o{ posts` means one user writes zero or more posts.

## The main parts

- **Accounts:** `users` and `sessions`. A session is one login on one device.
- **Communities:** `communities` and `community_memberships`.
- **Content:** `posts` and `comments`. A post belongs to one community and one author.
- **Social:** `user_follows`, `post_likes` and `comment_likes`.
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

**Soft deletes.** `users`, `posts` and `comments` have `deleted_at`. A delete sets this date. For posts and comments, it also removes the text. The row stays, so replies and likes do not lose their link. A deleted comment shows as `[deleted]` in its thread.

**Composite keys for join tables.** `post_likes`, `comment_likes`, `community_memberships` and `user_follows` use two columns as the primary key. Thus, a user can like a post only one time. `user_follows` also stops a user from following themselves.

**Uploads in two steps.** A `media_objects` row starts as `pending` when the upload starts. It changes to `ready` when the upload is complete. Only `ready` media can be attached to a post. `media_id` is unique in `post_media`, so each file belongs to only one post.
