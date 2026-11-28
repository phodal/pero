CREATE TABLE trial_submissions (
    project_id text NOT NULL,
    client_id text NOT NULL REFERENCES clients(id),
    operation_id text NOT NULL,
    input_digest text,
    run_id text UNIQUE REFERENCES runs(id),
    PRIMARY KEY (project_id, client_id, operation_id),
    CHECK ((input_digest IS NULL) = (run_id IS NULL))
);
