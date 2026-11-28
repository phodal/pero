CREATE TABLE paper_revisions (
    id text PRIMARY KEY,
    project_id text NOT NULL,
    owner_host text NOT NULL,
    local_project text NOT NULL,
    app_instance text NOT NULL,
    app_version text NOT NULL,
    revision text NOT NULL,
    media_type text NOT NULL,
    body bytea NOT NULL,
    UNIQUE (project_id, revision)
);

CREATE TABLE run_observation_receipts (
    project_id text NOT NULL,
    run_id text NOT NULL,
    request_id text NOT NULL,
    operation text NOT NULL,
    input_hash text NOT NULL,
    outcome text NOT NULL,
    PRIMARY KEY (project_id, run_id, request_id)
);
