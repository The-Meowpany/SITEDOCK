-- Repair migration — authored 2026-10-24 (data-loss incident follow-up).
--
-- The migration chain 0001–0013 no longer describes the canonical Prisma model:
-- several model changes were applied to databases with `prisma db push` and
-- never captured as migrations, so a database built from tracked migrations
-- alone drifted from schema.prisma. Applying 0006 fixed the hard failure at
-- 0012 (missing organization domain); this migration closes the remaining gap,
-- i.e. everything the chain still creates or lacks compared with the model:
--
--   * legacy objects that only 0001–0011 produce and the model no longer has
--     (`deployment_logs`, `deployments.deployed_at/superseded_at/is_preview`,
--     the legacy `DeploymentStatus` values DEPLOYING/LIVE/SUPERSEDED, redundant
--     indexes and foreign keys);
--   * columns the model declares as JSONB that the chain still creates as JSON;
--   * `connected_accounts.chargesEnabled/payoutsEnabled`, which the model
--     declares without an explicit @map (camelCase columns);
--   * a foreign key that 0008 silently skipped on clean databases because its
--     existence check matched a constraint of the same name in another schema;
--   * missing audit/outbox foreign keys and indexes.
--
-- It is forward-only and idempotent: on a database whose schema already matches
-- the model (`public`, `sitedock_test`, every installation that used
-- `prisma db push`) every statement is a no-op, and no data is touched. On a
-- clean database it converges the 0013 result to schema.prisma.
--
-- Prisma applies one migration per transaction; each statement below is scoped
-- to `current_schema()` so it can never reach another schema of the same
-- database.

-- ── Legacy objects removed from the model ───────────────────────────────────
-- `deployment_logs` (0002) was superseded by `service_deployment_logs` (0009)
-- and is not declared in schema.prisma. 0007 re-pointed its foreign key to
-- service_deployments, so the table is dropped with its constraints.
DROP TABLE IF EXISTS "deployment_logs";

-- Legacy website-deployment columns from 0002.
ALTER TABLE "deployments" DROP COLUMN IF EXISTS "deployed_at";
ALTER TABLE "deployments" DROP COLUMN IF EXISTS "superseded_at";
ALTER TABLE "deployments" DROP COLUMN IF EXISTS "is_preview";

-- Indexes that exist only in the migration chain.
DROP INDEX IF EXISTS "deployments_is_preview_idx";
DROP INDEX IF EXISTS "service_deployments_service_id_idx";
DROP INDEX IF EXISTS "service_deployments_status_idx";
DROP INDEX IF EXISTS "service_deployments_idempotency_key_key";

-- Foreign keys that the model does not declare.
ALTER TABLE "clients" DROP CONSTRAINT IF EXISTS "clients_user_id_fkey";
ALTER TABLE "project_charges" DROP CONSTRAINT IF EXISTS "project_charges_workspace_id_fkey";
ALTER TABLE "workspace_invitations" DROP CONSTRAINT IF EXISTS "workspace_invitations_invited_by_id_fkey";

-- ── DeploymentStatus: drop values the model no longer declares ───────────────
-- Only rebuilds when a legacy value is still present. If any row actually uses
-- one of the removed values the cast fails explicitly instead of losing data.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = current_schema()
      AND t.typname = 'DeploymentStatus'
      AND e.enumlabel IN ('DEPLOYING', 'LIVE', 'SUPERSEDED')
  ) THEN
    CREATE TYPE "DeploymentStatus_repair" AS ENUM ('QUEUED', 'BUILDING', 'READY', 'PUBLISHED', 'FAILED', 'CANCELED');

    ALTER TABLE "deployments" ALTER COLUMN "status" DROP DEFAULT;
    ALTER TABLE "deployments"
      ALTER COLUMN "status" TYPE "DeploymentStatus_repair"
      USING ("status"::text::"DeploymentStatus_repair");

    ALTER TYPE "DeploymentStatus" RENAME TO "DeploymentStatus_legacy";
    ALTER TYPE "DeploymentStatus_repair" RENAME TO "DeploymentStatus";
    DROP TYPE "DeploymentStatus_legacy";

    ALTER TABLE "deployments" ALTER COLUMN "status" SET DEFAULT 'QUEUED';
  END IF;
END $$;

-- ── JSON -> JSONB ───────────────────────────────────────────────────────────
-- 0001/0003 declared these columns as `Json`, which Prisma maps to JSON; the
-- model expects JSONB. Existing JSONB columns are left untouched.
DO $$
DECLARE
  target record;
BEGIN
  FOR target IN
    SELECT * FROM (VALUES
      ('audit_logs', 'metadata'),
      ('notifications', 'payload'),
      ('outbox_events', 'payload'),
      ('service_plans', 'features'),
      ('services', 'env'),
      ('subscription_events', 'metadata'),
      ('workspaces', 'branding')
    ) AS columns(table_name, column_name)
  LOOP
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = target.table_name
        AND column_name = target.column_name
        AND data_type = 'json'
    ) THEN
      EXECUTE format(
        'ALTER TABLE %I ALTER COLUMN %I SET DATA TYPE JSONB USING %I::jsonb',
        target.table_name,
        target.column_name,
        target.column_name
      );
    END IF;
  END LOOP;
END $$;

-- ── connected_accounts: model declares camelCase columns ────────────────────
-- Renaming keeps the data. If both spellings exist the database is in an
-- ambiguous state and the migration refuses rather than guessing.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'connected_accounts' AND column_name = 'charges_enabled')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'connected_accounts' AND column_name = 'chargesEnabled') THEN
    RAISE EXCEPTION 'connected_accounts has both charges_enabled and chargesEnabled; reconcile the duplicate columns manually before deploying this migration.';
  ELSIF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'connected_accounts' AND column_name = 'charges_enabled') THEN
    ALTER TABLE "connected_accounts" RENAME COLUMN "charges_enabled" TO "chargesEnabled";
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'connected_accounts' AND column_name = 'payouts_enabled')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'connected_accounts' AND column_name = 'payoutsEnabled') THEN
    RAISE EXCEPTION 'connected_accounts has both payouts_enabled and payoutsEnabled; reconcile the duplicate columns manually before deploying this migration.';
  ELSIF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'connected_accounts' AND column_name = 'payouts_enabled') THEN
    ALTER TABLE "connected_accounts" RENAME COLUMN "payouts_enabled" TO "payoutsEnabled";
  END IF;
END $$;

-- 0012 backfills projects.updated_at with a DEFAULT CURRENT_TIMESTAMP and
-- leaves the default behind; the model declares @updatedAt with no default.
ALTER TABLE "projects" ALTER COLUMN "updated_at" DROP DEFAULT;

-- ── Missing foreign keys and indexes ────────────────────────────────────────
-- 0008 skipped this constraint on a clean database: its existence check looked
-- for the name in the whole cluster, so any other schema that already had
-- `container_instances_service_id_fkey` made the block a no-op.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = current_schema() AND c.conname = 'container_instances_service_id_fkey'
  ) THEN
    ALTER TABLE "container_instances"
      ADD CONSTRAINT "container_instances_service_id_fkey"
      FOREIGN KEY ("service_id") REFERENCES "services"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = current_schema() AND c.conname = 'audit_logs_workspace_id_fkey'
  ) THEN
    ALTER TABLE "audit_logs"
      ADD CONSTRAINT "audit_logs_workspace_id_fkey"
      FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = current_schema() AND c.conname = 'audit_logs_actor_id_fkey'
  ) THEN
    ALTER TABLE "audit_logs"
      ADD CONSTRAINT "audit_logs_actor_id_fkey"
      FOREIGN KEY ("actor_id") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = current_schema() AND c.conname = 'outbox_events_workspace_id_fkey'
  ) THEN
    ALTER TABLE "outbox_events"
      ADD CONSTRAINT "outbox_events_workspace_id_fkey"
      FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "subscription_events_subscription_id_idx" ON "subscription_events"("subscription_id");

-- 0008 named the claim index by hand; the model uses Prisma's generated name.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'service_deployments_claim_idx')
     AND NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'service_deployments_status_next_retry_at_lease_expires_at_c_idx') THEN
    ALTER INDEX "service_deployments_claim_idx" RENAME TO "service_deployments_status_next_retry_at_lease_expires_at_c_idx";
  END IF;
END $$;
