-- Community moderators. One level: any moderator can add or remove others.
CREATE TABLE community_moderators (
    community_id uuid NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    added_by_id uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (community_id, user_id)
);

CREATE INDEX community_moderators_user_id_idx ON community_moderators (user_id);

-- Every existing community starts with its creator as its moderator.
INSERT INTO community_moderators (community_id, user_id)
SELECT id, creator_id FROM communities;

-- Users banned from posting and commenting in a community.
CREATE TABLE community_bans (
    community_id uuid NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    banned_by_id uuid REFERENCES users(id) ON DELETE SET NULL,
    reason varchar(500),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (community_id, user_id)
);

CREATE INDEX community_bans_user_id_idx ON community_bans (user_id);

-- Posts a moderator pinned to the top of their community.
ALTER TABLE posts ADD COLUMN pinned_at timestamptz;
CREATE INDEX posts_community_id_pinned_at_idx ON posts (community_id, pinned_at);
