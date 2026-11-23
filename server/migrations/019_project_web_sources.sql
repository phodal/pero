CREATE TABLE project_web_sources (
    project_id text NOT NULL,
    capture_id text NOT NULL,
    source jsonb NOT NULL,
    sha256 text NOT NULL,
    author_client_id text NOT NULL,
    saved_at bigint NOT NULL DEFAULT (floor(extract(epoch FROM clock_timestamp()) * 1000)),
    PRIMARY KEY (project_id, capture_id)
);
