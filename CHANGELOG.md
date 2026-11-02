# Changelog

All notable changes to this project are recorded here. Versions follow [Semantic Versioning](https://semver.org/).

## [0.2.0] - 2026-11-02

This release adds accounts, voting, post and comment management, feeds, and video and image uploads, and connects the frontend to the real API.

### Upgrading from 0.1.1

1. Install the new dependencies: `npm --prefix backend install`
2. Apply the new database migration: `npm --prefix backend run db:migrate`
3. Optionally, set the new settings in `.env` (see [Configuration](#configuration)).

The migration converts existing likes into upvotes. It has no automatic rollback (see [Database](#database)).

### Breaking changes

- **Likes are replaced by votes.** The `/like` endpoints are gone, and responses no longer include `_count.likes`. Use the `/vote` endpoints, and read `score` and `viewerVote` instead.
- **Writing requires a login.** Creating, editing, or deleting posts and comments, and voting, need an `Authorization: Bearer <token>` header. The author is always the logged-in user; any author ID in the request is ignored.
- **Only the author can edit or delete a post or comment.** Anyone else gets `403`.
- **Media posts need media.** `postType: "media"` posts must include 1-4 uploaded `mediaIds`.
- **Deleting a post deletes its media files** from storage.

### Added

#### Accounts (#23)

- `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me`, and `POST /api/auth/logout`.
- Sessions last 30 days. The token is returned once; the database stores only its SHA-256 hash.
- Usernames are 3-32 lowercase letters, numbers, or underscores, and passwords are 8-128 characters.

#### Posts, comments, and feeds (#24)

- Post validation by type: text posts need a body and can't have a URL; link posts need an `http` or `https` URL. Titles are 1-300 characters.
- Partial post edits with `PATCH /api/posts/:postId`. `null` or `""` clears `body` or `externalUrl`.
- Editing and deleting comments: `PATCH` and `DELETE /api/posts/:postId/comments/:commentId`. A deleted comment stays in its thread with a `null` body, so its replies keep their place, and it can't be replied to, edited, or voted on.
- Feeds, newest first, paged with `?limit=` (1-100, default 20) and `?cursor=`:
  - `GET /api/posts/feed`: your posts, posts by people you follow, and posts in communities you've joined.
  - `GET /api/communities/:communityId/posts`: one community's posts.

#### Voting (#27)

- Up and down votes on posts and comments:
  - `PUT /api/posts/:postId/vote` and `PUT /api/posts/:postId/comments/:commentId/vote` with `{ "value": 1 }` or `{ "value": -1 }`. Voting again with the same value changes nothing; voting with the other value switches the vote.
  - `DELETE` on the same paths removes your vote.
  - All four return `{ "score": number, "viewerVote": 1 | 0 | -1 }`.
- Posts and comments include `score` (the total of their votes) and `viewerVote` (your vote, or `0` if you haven't voted or aren't logged in).
- Reading posts, comments, and community feeds works without logging in. A token that is sent must be valid.

#### Communities (#27)

- `GET /api/communities` lists public communities with their member counts.

#### Frontend (#27)

- The frontend uses the real API instead of in-memory sample data.
- Log in, register, and log out; loading and error states; up/down voting; nested comment replies; and text and link posts.
- The API server now serves the frontend. Run `npm --prefix backend run dev` and open <http://localhost:3000>.

#### Video and image uploads (#26)

- Uploads go straight from the browser to object storage with a signed URL, in three steps: `POST /api/media`, a `PUT` of the file, then `POST /api/media/:mediaId/complete`. `GET /api/media/:mediaId` shows your own upload.
- Allowed files: MP4, WebM, and QuickTime video up to 500 MB and 2 hours; JPEG, PNG, GIF, and WebP images up to 20 MB; at most 7680x4320 (8K). A post can have up to 4.
- The contents of every upload are checked with ffprobe before it can be used, and its width, height, and length are recorded. A file that isn't what it claims to be, or breaks a limit, is deleted and the request gets `422` with the reason.
- Post and feed responses include `media`, each with a signed `url` that lasts an hour.
- Abandoned uploads are deleted automatically: unfinished and failed uploads after an hour, and finished uploads that never went on a post after a day. `npm --prefix backend run media:cleanup` runs this once.

#### Developer tooling

- New test scripts: `test:auth`, `test:posts`, and `test:media`.
- New script: `media:cleanup`.

### Changed

- Request bodies that aren't valid JSON now get `400`, and bodies over the size limit get `413`. Before, both returned `500` (#25).
- Malformed or unknown IDs now get `400` or `404` instead of `500` (#24).

### Database

One new migration, `202611020001_votes`, from #27. Media uploads (#26) use the existing `media_objects` and `post_media` tables and need no schema change.

**Likes become votes:**

- `post_likes` is renamed to `post_votes`, and `comment_likes` to `comment_votes`. Their keys, foreign keys, and indexes are renamed to match.
- Both tables get a `value` column (`smallint`, `1` for an upvote or `-1` for a downvote, enforced by a check constraint).
- **Existing likes become upvotes** (`value = 1`). No votes are lost.

**Scores:**

- `posts` and `comments` get a `score` column (`integer`, default `0`), which is the total of their votes. Existing rows are filled in from their likes.
- Triggers keep `score` up to date when a vote is added, changed, or removed: `post_votes_score` (function `apply_post_vote`) and `comment_votes_score` (function `apply_comment_vote`). Application code should not write `score` directly.

**Rolling back:** there is no down migration. To undo it, rename the tables and constraints back, drop the `value` and `score` columns, and drop both triggers and functions. Downvotes would be lost.

**Media data:** `media_objects.width`, `height`, and `duration_seconds` are now filled in when an upload completes. Abandoned uploads are deleted from `media_objects` by the cleanup job.

### Configuration

New optional settings in `.env`, all listed in `.env.example`:

| Variable | Default | Purpose |
|---|---|---|
| `S3_ENDPOINT` | `http://localhost:$S3_PORT` | Where the API reaches object storage |
| `S3_PUBLIC_ENDPOINT` | same as `S3_ENDPOINT` | The storage address browsers use for upload and view URLs |
| `FFPROBE_PATH` | the binary from `@ffprobe-installer/ffprobe` | A different ffprobe to use |
| `MEDIA_CLEANUP_INTERVAL_MINUTES` | `15` | How often the API server deletes abandoned uploads; `0` turns it off |

New dependencies: `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`, and `@ffprobe-installer/ffprobe`.

### Known issues

- After logging in or registering, the community list is empty until the page is reloaded, so posts can't be created until then.
- The frontend doesn't show or upload media yet; media posts work only through the API.
- Feeds in the frontend show only the first 20 posts.
- There are no endpoints yet to create or join communities or to follow users.
- `docs/swe_erd_v2.pdf` still shows `post_likes` and `comment_likes`; `docs/erd.md` is up to date.

## [0.1.1] - 2026-10-19

- Set the backend version to 0.1.1.
