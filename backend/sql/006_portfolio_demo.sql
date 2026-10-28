CREATE TABLE IF NOT EXISTS demo_instances (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 expires_at TIMESTAMPTZ NOT NULL
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS demo_instance_id UUID REFERENCES demo_instances(id) ON DELETE RESTRICT;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS demo_instance_id UUID REFERENCES demo_instances(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_demo_instances_expiry ON demo_instances(expires_at);
CREATE INDEX IF NOT EXISTS idx_users_demo_instance ON users(demo_instance_id) WHERE demo_instance_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_workspaces_one_per_demo
 ON workspaces(demo_instance_id)
 WHERE demo_instance_id IS NOT NULL;
