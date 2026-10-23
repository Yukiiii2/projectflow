ALTER TABLE email_outbox ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

UPDATE email_outbox
SET expires_at = COALESCE((payload->>'expiresAt')::timestamptz, now() + interval '1 hour')
WHERE expires_at IS NULL;

ALTER TABLE email_outbox ALTER COLUMN expires_at SET NOT NULL;

DROP INDEX IF EXISTS idx_email_outbox_ready;
CREATE INDEX idx_email_outbox_ready
  ON email_outbox(available_at, created_at)
  WHERE locked_at IS NULL AND attempts < 5;
