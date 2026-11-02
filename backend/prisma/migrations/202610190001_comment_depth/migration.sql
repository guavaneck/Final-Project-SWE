-- Number of replies between a comment and the post: 0 for top-level comments, parent depth + 1 for replies.
ALTER TABLE comments ADD COLUMN depth integer NOT NULL DEFAULT 0 CHECK (depth >= 0);
