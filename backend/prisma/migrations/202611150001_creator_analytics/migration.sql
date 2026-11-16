CREATE TABLE post_views (
    id uuid PRIMARY KEY,
    post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    viewer_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    viewed_day date NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT post_views_post_id_viewer_id_viewed_day_key UNIQUE (post_id, viewer_id, viewed_day)
);
CREATE INDEX post_views_post_id_created_at_idx ON post_views(post_id, created_at);

CREATE TABLE post_shares (
    id uuid PRIMARY KEY,
    post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX post_shares_post_id_created_at_idx ON post_shares(post_id, created_at);

CREATE TABLE post_vote_events (
    id uuid PRIMARY KEY,
    post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    old_value smallint NOT NULL CONSTRAINT post_vote_events_old_value_check CHECK (old_value IN (-1, 0, 1)),
    new_value smallint NOT NULL CONSTRAINT post_vote_events_new_value_check CHECK (new_value IN (-1, 0, 1)),
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT post_vote_events_changed_check CHECK (old_value <> new_value)
);
CREATE INDEX post_vote_events_post_id_created_at_idx ON post_vote_events(post_id, created_at);
