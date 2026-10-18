CREATE TYPE account_status AS ENUM ('active', 'disabled', 'deleted');
CREATE TYPE visibility AS ENUM ('public', 'private');
CREATE TYPE post_type AS ENUM ('text', 'link', 'media');
CREATE TYPE upload_status AS ENUM ('pending', 'ready', 'failed');

CREATE TABLE users (
    id uuid PRIMARY KEY,
    username varchar(32) NOT NULL,
    email varchar(320) NOT NULL,
    password_hash text NOT NULL,
    display_name varchar(80) NOT NULL,
    bio varchar(500),
    account_status account_status NOT NULL DEFAULT 'active',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz
);

CREATE UNIQUE INDEX users_username_key ON users (username);
CREATE UNIQUE INDEX users_email_key ON users (email);

CREATE TABLE sessions (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash varchar(128) NOT NULL UNIQUE,
    device_name varchar(120),
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX sessions_user_id_idx ON sessions (user_id);

CREATE TABLE media_objects (
    id uuid PRIMARY KEY,
    owner_id uuid NOT NULL REFERENCES users(id),
    bucket varchar(63) NOT NULL,
    object_key text NOT NULL,
    mime_type varchar(255) NOT NULL,
    size_bytes bigint NOT NULL CHECK (size_bytes >= 0),
    checksum_sha256 char(64),
    upload_status upload_status NOT NULL DEFAULT 'pending',
    width integer CHECK (width IS NULL OR width > 0),
    height integer CHECK (height IS NULL OR height > 0),
    duration_seconds numeric(12, 3) CHECK (duration_seconds IS NULL OR duration_seconds >= 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz,
    UNIQUE (bucket, object_key)
);

ALTER TABLE users
    ADD COLUMN avatar_media_id uuid REFERENCES media_objects(id) ON DELETE SET NULL;

CREATE INDEX media_objects_owner_id_idx ON media_objects (owner_id);
CREATE TABLE communities (
    id uuid PRIMARY KEY,
    creator_id uuid NOT NULL REFERENCES users(id),
    slug varchar(64) NOT NULL,
    name varchar(100) NOT NULL,
    description varchar(1000),
    visibility visibility NOT NULL DEFAULT 'public',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX communities_slug_key ON communities (slug);

CREATE TABLE community_memberships (
    community_id uuid NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (community_id, user_id)
);

CREATE INDEX community_memberships_user_id_idx
    ON community_memberships (user_id, community_id);

CREATE TABLE user_follows (
    follower_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    followed_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (follower_id, followed_id),
    CHECK (follower_id <> followed_id)
);

CREATE INDEX user_follows_followed_id_idx ON user_follows (followed_id);

CREATE TABLE posts (
    id uuid PRIMARY KEY,
    author_id uuid NOT NULL REFERENCES users(id),
    community_id uuid NOT NULL REFERENCES communities(id),
    post_type post_type NOT NULL,
    title varchar(300) NOT NULL,
    body text,
    external_url text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz,
    CHECK (
        deleted_at IS NOT NULL
        OR (post_type = 'text' AND body IS NOT NULL AND external_url IS NULL)
        OR (post_type = 'link' AND external_url IS NOT NULL)
        OR post_type = 'media'
    )
);

CREATE INDEX posts_community_feed_idx
    ON posts (community_id, created_at DESC, id DESC);
CREATE INDEX posts_author_feed_idx
    ON posts (author_id, created_at DESC, id DESC);

CREATE TABLE post_media (
    post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    media_id uuid NOT NULL REFERENCES media_objects(id),
    position smallint NOT NULL CHECK (position >= 0),
    PRIMARY KEY (post_id, media_id),
    UNIQUE (post_id, position),
    UNIQUE (media_id)
);

CREATE TABLE comments (
    id uuid PRIMARY KEY,
    post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    author_id uuid NOT NULL REFERENCES users(id),
    parent_id uuid,
    body text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz,
    CHECK (deleted_at IS NOT NULL OR body IS NOT NULL),
    UNIQUE (id, post_id),
    FOREIGN KEY (parent_id, post_id) REFERENCES comments(id, post_id)
);

CREATE INDEX comments_post_idx ON comments (post_id, created_at, id);
CREATE INDEX comments_parent_idx ON comments (parent_id, created_at, id);

CREATE TABLE post_likes (
    post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (post_id, user_id)
);

CREATE INDEX post_likes_user_id_idx ON post_likes (user_id);

CREATE TABLE comment_likes (
    comment_id uuid NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (comment_id, user_id)
);

CREATE INDEX comment_likes_user_id_idx ON comment_likes (user_id);
