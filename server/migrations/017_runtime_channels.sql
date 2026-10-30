ALTER TABLE workers ADD COLUMN runtime_profile text NOT NULL DEFAULT '';
CREATE TABLE runtime_channels (
 run_id text PRIMARY KEY REFERENCES runs(id),
 session_id text NOT NULL UNIQUE,
 secret_hash text NOT NULL,
 data jsonb NOT NULL
);
CREATE TABLE runtime_provider_attempts (
 id text PRIMARY KEY,
 run_id text NOT NULL REFERENCES runtime_channels(run_id),
 finished boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
