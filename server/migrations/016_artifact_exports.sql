-- Output data has a separate lifetime from compute resources. No FK cascade
-- may erase an export, immutable manifest, or data-deletion authorization.
CREATE TABLE artifact_exports (
    id text PRIMARY KEY,
    run_id text NOT NULL REFERENCES runs(id),
    generation bigint NOT NULL CHECK (generation > 0),
    project_id text NOT NULL,
    version bigint NOT NULL CHECK (version > 0),
    phase text NOT NULL CHECK (phase IN ('reserved','collecting','committed')),
    data jsonb NOT NULL,
    UNIQUE(run_id,generation)
);
CREATE INDEX artifact_exports_pending ON artifact_exports(run_id) WHERE phase <> 'committed';

-- Reserve bytes before uploading. A verified row means the trusted backend
-- re-read the immutable object and checked its actual SHA-256 and byte count.
CREATE TABLE artifact_objects (
    export_id text NOT NULL REFERENCES artifact_exports(id),
    entry_id text NOT NULL,
    bytes bigint NOT NULL CHECK (bytes >= 0),
    verified boolean NOT NULL DEFAULT false,
    data jsonb NOT NULL,
    PRIMARY KEY(export_id,entry_id)
);
