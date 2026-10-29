-- A trusted sandbox Worker cannot fall back to the ordinary queue, even if its
-- process omits the new Pod identity field or the runtime config is disabled.
ALTER TABLE workers ADD COLUMN runtime_only boolean NOT NULL DEFAULT false;
ALTER TABLE claims ADD COLUMN runtime_pod_uid text NOT NULL DEFAULT '';

CREATE TABLE runtime_bindings (
    run_id text PRIMARY KEY REFERENCES runs(id),
    worker_id text NOT NULL REFERENCES workers(id),
    version bigint NOT NULL CHECK (version > 0),
    phase text NOT NULL CHECK (phase IN ('pending','ready','reconcile','cleanup_pending','released')),
    pod_uid text NOT NULL DEFAULT '',
    valid_until timestamptz,
    data jsonb NOT NULL
);
-- This first deployment has one trusted Worker slot; an unsettled resource is
-- never hidden by allocating another claim for the same Worker.
CREATE UNIQUE INDEX one_unreleased_runtime_per_worker ON runtime_bindings(worker_id)
    WHERE phase <> 'released';
