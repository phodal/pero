ALTER TABLE runs ADD COLUMN desktop_profile text NOT NULL DEFAULT '' CHECK (desktop_profile IN ('', 'blender'));

CREATE TABLE run_desktop_files (
    run_id text NOT NULL REFERENCES runs(id),
    name text NOT NULL CHECK (name IN ('screenshot.png', 'screenshot.jpg', 'actions.json', 'result.blend', 'result.obj')),
    sha256 text NOT NULL,
    content bytea NOT NULL CHECK (octet_length(content) BETWEEN 1 AND 8388608),
    PRIMARY KEY (run_id, name)
);
