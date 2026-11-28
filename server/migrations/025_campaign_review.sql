ALTER TABLE research_campaigns ADD COLUMN mode text NOT NULL DEFAULT '';
ALTER TABLE research_campaigns ADD COLUMN decision jsonb;
ALTER TABLE research_campaigns ADD COLUMN checker_digest text NOT NULL DEFAULT '';
CREATE TABLE campaign_verifications (
    campaign_id text NOT NULL REFERENCES research_campaigns(id),
    trial_index integer NOT NULL,
    observed jsonb NOT NULL,
    PRIMARY KEY (campaign_id, trial_index)
);
CREATE TABLE campaign_decision_requests (
    campaign_id text NOT NULL REFERENCES research_campaigns(id),
    request_id text NOT NULL,
    payload jsonb NOT NULL,
    received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (campaign_id, request_id)
);
