ALTER TABLE runs ADD COLUMN reconciliation jsonb CHECK (reconciliation IS NULL OR status = 'reconcile');
