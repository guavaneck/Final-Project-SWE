-- Short, URL-friendly post ID: 12 Crockford base32 characters (60 bits). The uuid id stays the internal key.
ALTER TABLE posts ADD COLUMN public_id varchar(12);

-- Backfill existing posts. The WHERE clause references the outer row so a new ID is generated per post.
UPDATE posts SET public_id = (
    SELECT string_agg(substr('0123456789ABCDEFGHJKMNPQRSTVWXYZ', floor(random() * 32)::int + 1, 1), '')
    FROM generate_series(1, 12)
    WHERE posts.id IS NOT NULL
);

ALTER TABLE posts ALTER COLUMN public_id SET NOT NULL;
ALTER TABLE posts ADD CONSTRAINT posts_public_id_format CHECK (public_id ~ '^[0-9A-HJKMNP-TV-Z]{12}$');
CREATE UNIQUE INDEX posts_public_id_key ON posts (public_id);
