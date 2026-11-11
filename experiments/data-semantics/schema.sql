PRAGMA foreign_keys=ON;
CREATE TABLE dataset_version (
  version TEXT PRIMARY KEY, export_sha256 TEXT NOT NULL, source_sha256 TEXT NOT NULL
);
CREATE TABLE sample (
  sample_id INTEGER PRIMARY KEY, version TEXT NOT NULL REFERENCES dataset_version(version),
  sepal_length_cm REAL NOT NULL, sepal_width_cm REAL NOT NULL,
  petal_length_cm REAL NOT NULL, petal_width_cm REAL NOT NULL
);
CREATE TABLE annotation (
  sample_id INTEGER PRIMARY KEY REFERENCES sample(sample_id), species TEXT NOT NULL
);
CREATE TABLE run (
  run_id TEXT PRIMARY KEY, method TEXT NOT NULL, seed INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('complete','failed')),
  dataset_version TEXT NOT NULL, split TEXT NOT NULL, preprocessing TEXT NOT NULL, protocol TEXT NOT NULL,
  UNIQUE(method,seed,dataset_version,split,preprocessing,protocol)
);
CREATE TABLE metric (
  run_id TEXT NOT NULL REFERENCES run(run_id), name TEXT NOT NULL, value REAL,
  unit TEXT NOT NULL CHECK(unit IN ('fraction','percent')), sample_count INTEGER NOT NULL CHECK(sample_count>0),
  PRIMARY KEY(run_id,name)
);
