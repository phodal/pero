-- Unknown visibility stays private until the next sync observes the repository.
ALTER TABLE github_repositories ADD COLUMN private boolean NOT NULL DEFAULT true;
