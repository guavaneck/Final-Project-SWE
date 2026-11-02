ALTER TABLE post_likes RENAME TO post_votes;
ALTER TABLE post_votes RENAME CONSTRAINT post_likes_pkey TO post_votes_pkey;
ALTER TABLE post_votes RENAME CONSTRAINT post_likes_post_id_fkey TO post_votes_post_id_fkey;
ALTER TABLE post_votes RENAME CONSTRAINT post_likes_user_id_fkey TO post_votes_user_id_fkey;
ALTER INDEX post_likes_user_id_idx RENAME TO post_votes_user_id_idx;
ALTER TABLE post_votes ADD COLUMN value smallint NOT NULL DEFAULT 1 CONSTRAINT post_votes_value_check CHECK (value IN (-1, 1));
ALTER TABLE post_votes ALTER COLUMN value DROP DEFAULT;

ALTER TABLE comment_likes RENAME TO comment_votes;
ALTER TABLE comment_votes RENAME CONSTRAINT comment_likes_pkey TO comment_votes_pkey;
ALTER TABLE comment_votes RENAME CONSTRAINT comment_likes_comment_id_fkey TO comment_votes_comment_id_fkey;
ALTER TABLE comment_votes RENAME CONSTRAINT comment_likes_user_id_fkey TO comment_votes_user_id_fkey;
ALTER INDEX comment_likes_user_id_idx RENAME TO comment_votes_user_id_idx;
ALTER TABLE comment_votes ADD COLUMN value smallint NOT NULL DEFAULT 1 CONSTRAINT comment_votes_value_check CHECK (value IN (-1, 1));
ALTER TABLE comment_votes ALTER COLUMN value DROP DEFAULT;

-- score is the total of a post's or comment's votes
ALTER TABLE posts ADD COLUMN score integer NOT NULL DEFAULT 0;
ALTER TABLE comments ADD COLUMN score integer NOT NULL DEFAULT 0;

UPDATE posts SET score = (SELECT coalesce(sum(value), 0) FROM post_votes WHERE post_votes.post_id = posts.id);
UPDATE comments SET score = (SELECT coalesce(sum(value), 0) FROM comment_votes WHERE comment_votes.comment_id = comments.id);

CREATE FUNCTION apply_post_vote() RETURNS trigger AS $$
BEGIN
    IF TG_OP IN ('UPDATE', 'DELETE') THEN
        UPDATE posts SET score = score - OLD.value WHERE id = OLD.post_id;
    END IF;
    IF TG_OP IN ('INSERT', 'UPDATE') THEN
        UPDATE posts SET score = score + NEW.value WHERE id = NEW.post_id;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER post_votes_score AFTER INSERT OR UPDATE OR DELETE ON post_votes
    FOR EACH ROW EXECUTE FUNCTION apply_post_vote();

CREATE FUNCTION apply_comment_vote() RETURNS trigger AS $$
BEGIN
    IF TG_OP IN ('UPDATE', 'DELETE') THEN
        UPDATE comments SET score = score - OLD.value WHERE id = OLD.comment_id;
    END IF;
    IF TG_OP IN ('INSERT', 'UPDATE') THEN
        UPDATE comments SET score = score + NEW.value WHERE id = NEW.comment_id;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER comment_votes_score AFTER INSERT OR UPDATE OR DELETE ON comment_votes
    FOR EACH ROW EXECUTE FUNCTION apply_comment_vote();
