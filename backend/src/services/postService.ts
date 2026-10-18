// Business logic and database access for posts. Knows nothing about HTTP (no req/res), so it's easy to test and reuse.
// Belongs here: e.g. createPost saves a new post with score 0 and commentCount 0, and votePost updates a post's score.
