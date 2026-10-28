CREATE TABLE desktop_grants (
    digest bytea PRIMARY KEY,
    user_id bigint NOT NULL REFERENCES community_users(id),
    challenge text NOT NULL,
    expires_at timestamptz NOT NULL
);
CREATE TABLE desktop_credentials (
    id text PRIMARY KEY,
    client_id text NOT NULL REFERENCES clients(id),
    token_hash bytea NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
