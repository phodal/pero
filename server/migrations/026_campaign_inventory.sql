ALTER TABLE research_campaigns ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX research_campaigns_project_inventory ON research_campaigns (project_id, created_at DESC, id DESC);
