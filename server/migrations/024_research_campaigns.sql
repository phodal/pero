CREATE TABLE research_campaigns (
    id text PRIMARY KEY,
    project_id text NOT NULL,
    owner_id text NOT NULL REFERENCES clients(id),
    request_id text NOT NULL,
    runner_id text NOT NULL REFERENCES clients(id),
    plan_digest text NOT NULL,
    plan jsonb NOT NULL,
    workflow_run_id text,
    cancel_requested boolean NOT NULL DEFAULT false,
    result jsonb,
    UNIQUE (project_id, owner_id, request_id)
);
