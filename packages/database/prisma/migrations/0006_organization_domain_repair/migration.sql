-- Repair migration — authored 2026-10-24 (data-loss incident follow-up).
--
-- Problem: no migration in this directory ever created the organization domain.
-- `organizations`, `organization_members`, `account_organizations`, the
-- `OrganizationRole` enum and the `organization_id` columns that reference them
-- existed only because the development database had been shaped with
-- `prisma db push`. On a clean database the chain therefore failed at
-- `0012_add_environment_and_roles` with:
--
--   Database error code: 42704
--   ERROR: type "OrganizationRole" does not exist
--
-- so SiteDock could not be installed from tracked migrations alone. See
-- docs/MIGRATION_BOOTSTRAP_REPAIR_PLAN.md and
-- docs/INCIDENT_2026-10-24_DATA_LOSS.md.
--
-- This file is new work, not a recovered historical migration. It sits at the
-- `0006` slot only because Prisma applies migrations in lexical order and
-- `0012` needs these objects to exist; every statement is idempotent, so a
-- database that already received these objects out of band (`public`,
-- `sitedock_test`) goes through this migration as a pure no-op. Ordering-only
-- repair for the rest of the model drift lives in `0014_reconcile_model_drift`.
--
-- Every statement is also schema-scoped (`current_schema()`), so it can never
-- inspect or create an object in another schema of the same database.

-- ── OrganizationRole ──────────────────────────────────────────────────────────
-- 0012 appends the three newer roles with `ADD VALUE IF NOT EXISTS`, so the
-- enum is created here with the full value set from schema.prisma.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = current_schema() AND t.typname = 'OrganizationRole'
  ) THEN
    CREATE TYPE "OrganizationRole" AS ENUM (
      'OWNER',
      'ORGANIZATION_ADMINISTRATOR',
      'ADMINISTRATOR',
      'DEVELOPER',
      'OPERATOR',
      'ANALYST',
      'VIEWER'
    );
  END IF;
END $$;

-- ── Organization domain tables ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "organizations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "organization_members" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" "OrganizationRole" NOT NULL,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "invited_at" TIMESTAMP(3),

    CONSTRAINT "organization_members_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "account_organizations" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "role" "OrganizationRole" NOT NULL,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_organizations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "organizations_slug_key" ON "organizations"("slug");
CREATE INDEX IF NOT EXISTS "organization_members_user_id_idx" ON "organization_members"("user_id");
CREATE UNIQUE INDEX IF NOT EXISTS "organization_members_organization_id_user_id_key" ON "organization_members"("organization_id", "user_id");
CREATE INDEX IF NOT EXISTS "account_organizations_organization_id_idx" ON "account_organizations"("organization_id");
CREATE UNIQUE INDEX IF NOT EXISTS "account_organizations_account_id_organization_id_key" ON "account_organizations"("account_id", "organization_id");

-- ── organization_id columns on the models that reference an organization ─────
-- `projects.organization_id` is optional in the model (0012 relaxes it to
-- NULL). `websites` and `service_plans` require it; ADD COLUMN ... NOT NULL
-- only works because both tables are empty on a database built from migrations
-- (0001 is the only migration that inserts nothing, so this is always true at
-- this point). On an existing database the columns already exist and both
-- statements are skipped by IF NOT EXISTS.
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "organization_id" TEXT;
CREATE INDEX IF NOT EXISTS "projects_organization_id_idx" ON "projects"("organization_id");

ALTER TABLE "websites" ADD COLUMN IF NOT EXISTS "organization_id" TEXT NOT NULL;
CREATE INDEX IF NOT EXISTS "websites_organization_id_idx" ON "websites"("organization_id");

ALTER TABLE "service_plans" ADD COLUMN IF NOT EXISTS "organization_id" TEXT NOT NULL;
CREATE INDEX IF NOT EXISTS "service_plans_organization_id_idx" ON "service_plans"("organization_id");

-- Fail closed instead of leaving silent drift when an existing database has a
-- nullable organization_id where the model requires one.
DO $$
DECLARE
  offending text;
BEGIN
  SELECT string_agg(table_name, ', ' ORDER BY table_name) INTO offending
  FROM information_schema.columns
  WHERE table_schema = current_schema()
    AND column_name = 'organization_id'
    AND table_name IN ('websites', 'service_plans')
    AND is_nullable = 'YES';

  IF offending IS NOT NULL THEN
    RAISE EXCEPTION
      'organization_id must be NOT NULL on: %. Reconcile the column explicitly before deploying this migration.',
      offending;
  END IF;
END $$;

-- ── Foreign keys ────────────────────────────────────────────────────────────
-- Schema-qualified existence checks: 0008 matched constraint names across the
-- whole cluster, which silently skipped object creation when another schema
-- already had the same constraint name.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = current_schema() AND c.conname = 'organization_members_organization_id_fkey'
  ) THEN
    ALTER TABLE "organization_members"
      ADD CONSTRAINT "organization_members_organization_id_fkey"
      FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = current_schema() AND c.conname = 'organization_members_user_id_fkey'
  ) THEN
    ALTER TABLE "organization_members"
      ADD CONSTRAINT "organization_members_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = current_schema() AND c.conname = 'account_organizations_account_id_fkey'
  ) THEN
    ALTER TABLE "account_organizations"
      ADD CONSTRAINT "account_organizations_account_id_fkey"
      FOREIGN KEY ("account_id") REFERENCES "users"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = current_schema() AND c.conname = 'account_organizations_organization_id_fkey'
  ) THEN
    ALTER TABLE "account_organizations"
      ADD CONSTRAINT "account_organizations_organization_id_fkey"
      FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = current_schema() AND c.conname = 'projects_organization_id_fkey'
  ) THEN
    ALTER TABLE "projects"
      ADD CONSTRAINT "projects_organization_id_fkey"
      FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = current_schema() AND c.conname = 'websites_organization_id_fkey'
  ) THEN
    ALTER TABLE "websites"
      ADD CONSTRAINT "websites_organization_id_fkey"
      FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = current_schema() AND c.conname = 'service_plans_organization_id_fkey'
  ) THEN
    ALTER TABLE "service_plans"
      ADD CONSTRAINT "service_plans_organization_id_fkey"
      FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
