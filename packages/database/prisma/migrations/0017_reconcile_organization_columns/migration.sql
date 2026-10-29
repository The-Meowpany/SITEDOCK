-- M19: reconcile organization scoping on service_plans and websites.
--
-- service_plans are workspace-scoped (billing routes create plans under a
-- workspace and the repository queries them by workspace_id only). Migration
-- 0006 added a NOT NULL organization_id column, foreign key and index to
-- service_plans, but nothing in the application layer sets or reads it, so the
-- column is unused dead state. Remove it.
--
-- websites are created without an organization_id (CreateWebsiteUseCase only
-- sets workspace_id / project_id / name), so websites.organization_id must be
-- nullable. Migration 0006 created it NOT NULL, which would reject website
-- creation. Relax it to nullable. The index created by 0006 is retained and
-- now declared on the Website model.
--
-- Forward-only and idempotent.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = current_schema() AND c.conname = 'service_plans_organization_id_fkey'
  ) THEN
    ALTER TABLE "service_plans" DROP CONSTRAINT "service_plans_organization_id_fkey";
  END IF;
END $$;

DROP INDEX IF EXISTS "service_plans_organization_id_idx";

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'service_plans' AND column_name = 'organization_id'
  ) THEN
    ALTER TABLE "service_plans" DROP COLUMN "organization_id";
  END IF;
END $$;

-- websites.organization_id must be nullable: website creation never supplies it.
ALTER TABLE "websites" ALTER COLUMN "organization_id" DROP NOT NULL;
