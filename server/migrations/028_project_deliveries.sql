CREATE TABLE project_deliveries (
    id text PRIMARY KEY,
    project_id text NOT NULL,
    owner_id text NOT NULL REFERENCES clients(id),
    manifest jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX project_deliveries_project_created
    ON project_deliveries (project_id, created_at DESC, id DESC);
