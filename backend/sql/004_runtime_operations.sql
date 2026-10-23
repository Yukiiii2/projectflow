-- Keep only the newest outstanding token before enforcing one active token per purpose.
WITH ranked_tokens AS (
  SELECT id, row_number() OVER (PARTITION BY user_id, purpose ORDER BY created_at DESC, id DESC) AS position
  FROM auth_tokens
  WHERE consumed_at IS NULL
)
UPDATE auth_tokens
SET consumed_at = now()
WHERE id IN (SELECT id FROM ranked_tokens WHERE position > 1);

CREATE UNIQUE INDEX IF NOT EXISTS idx_auth_tokens_one_active
  ON auth_tokens(user_id, purpose)
  WHERE consumed_at IS NULL;

CREATE TABLE IF NOT EXISTS "session" (
  sid VARCHAR PRIMARY KEY,
  sess JSON NOT NULL,
  expire TIMESTAMP(6) NOT NULL
);

CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session"(expire);

CREATE TABLE IF NOT EXISTS email_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT NOT NULL CHECK(kind IN ('invitation','email_verification','password_reset')),
  payload JSONB NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0),
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_outbox_ready
  ON email_outbox(available_at, created_at)
  WHERE locked_at IS NULL;
