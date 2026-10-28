CREATE TABLE contribution_pull_requests (
 task_id text PRIMARY KEY REFERENCES community_tasks(task_id),
 client_id text NOT NULL REFERENCES clients(id),
 url text NOT NULL,
 branch text NOT NULL,
 head_sha text NOT NULL,
 source_revision text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
