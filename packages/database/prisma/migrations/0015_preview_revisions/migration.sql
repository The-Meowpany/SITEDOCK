-- M17: durable preview deployments.
--
-- A preview is the branch-scoped routing identity; every build attempt is an
-- immutable PreviewRevision pinned to a commit SHA. Routing reads the preview's
-- active revision pointer, which is only swapped after a container passed its
-- health check. Lease columns mirror service_deployments so a stale worker can
-- never publish state it no longer owns.
--
-- Forward-only and idempotent: safe on a database that never had a previews
-- table and on one created earlier with `prisma db push` (legacy camelCase
-- columns are preserved and backfilled, never dropped).

-- ── Enums ──────────────────────────────────────────────────────────────────
-- Runtime lifecycle values that earlier migrations create only partially.
ALTER TYPE "ServiceDeploymentStatus" ADD VALUE IF NOT EXISTS 'DEPLOYING';
ALTER TYPE "ServiceDeploymentStatus" ADD VALUE IF NOT EXISTS 'LIVE';
ALTER TYPE "ServiceDeploymentStatus" ADD VALUE IF NOT EXISTS 'SUPERSEDED';
ALTER TYPE "ContainerInstanceStatus" ADD VALUE IF NOT EXISTS 'STARTING';
ALTER TYPE "ServiceType" ADD VALUE IF NOT EXISTS 'DATABASE';
ALTER TYPE "ServiceType" ADD VALUE IF NOT EXISTS 'CRON';
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'PreviewStatus' AND n.nspname = current_schema()
  ) THEN
    CREATE TYPE "PreviewStatus" AS ENUM ('PENDING', 'BUILDING', 'READY', 'FAILED', 'CANCELED');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'PreviewCleanupStatus' AND n.nspname = current_schema()
  ) THEN
    CREATE TYPE "PreviewCleanupStatus" AS ENUM ('NONE', 'REQUESTED', 'RUNNING', 'COMPLETED', 'FAILED');
  END IF;
END $$;

-- ── previews ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "previews" (
    "id" TEXT NOT NULL,
    "website_id" TEXT NOT NULL,
    "branch" TEXT NOT NULL,
    "commit_sha" TEXT NOT NULL,
    "status" "PreviewStatus" NOT NULL DEFAULT 'PENDING',
    "hostname" TEXT,
    "deployment_id" TEXT,
    "cleanup_status" "PreviewCleanupStatus" NOT NULL DEFAULT 'NONE',
    "cleanup_error" TEXT,
    "cleanup_requested_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "previews_pkey" PRIMARY KEY ("id")
);

-- Backfill from the legacy camelCase shape if this table was created by an
-- earlier `prisma db push`. New databases never execute these branches.
ALTER TABLE "previews" ADD COLUMN IF NOT EXISTS "website_id" TEXT;
ALTER TABLE "previews" ADD COLUMN IF NOT EXISTS "commit_sha" TEXT;
ALTER TABLE "previews" ADD COLUMN IF NOT EXISTS "deployment_id" TEXT;
ALTER TABLE "previews" ADD COLUMN IF NOT EXISTS "cleanup_status" "PreviewCleanupStatus" NOT NULL DEFAULT 'NONE';
ALTER TABLE "previews" ADD COLUMN IF NOT EXISTS "cleanup_error" TEXT;
ALTER TABLE "previews" ADD COLUMN IF NOT EXISTS "cleanup_requested_at" TIMESTAMP(3);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'previews' AND column_name = 'commitSha'
  ) THEN
    EXECUTE 'UPDATE "previews" SET "commit_sha" = "commitSha" WHERE "commit_sha" IS NULL';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'previews' AND column_name = 'deploymentId'
  ) THEN
    EXECUTE 'UPDATE "previews" SET "deployment_id" = "deploymentId" WHERE "deployment_id" IS NULL';
  END IF;
END $$;

UPDATE "previews" SET "commit_sha" = '' WHERE "commit_sha" IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'previews_website_id_fkey'
      AND conrelid = '"previews"'::regclass
  ) THEN
    ALTER TABLE "previews"
      ADD CONSTRAINT "previews_website_id_fkey"
      FOREIGN KEY ("website_id") REFERENCES "websites"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'previews_website_id_branch_key'
      AND conrelid = '"previews"'::regclass
  ) THEN
    ALTER TABLE "previews"
      ADD CONSTRAINT "previews_website_id_branch_key" UNIQUE ("website_id", "branch");
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'previews_hostname_key'
      AND conrelid = '"previews"'::regclass
  ) THEN
    ALTER TABLE "previews"
      ADD CONSTRAINT "previews_hostname_key" UNIQUE ("hostname");
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "previews_website_id_idx" ON "previews"("website_id");
CREATE INDEX IF NOT EXISTS "previews_commit_sha_idx" ON "previews"("commit_sha");
CREATE INDEX IF NOT EXISTS "previews_cleanup_status_idx" ON "previews"("cleanup_status");

-- ── preview_revisions ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "preview_revisions" (
    "id" TEXT NOT NULL,
    "preview_id" TEXT NOT NULL,
    "commit_sha" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "status" "PreviewStatus" NOT NULL DEFAULT 'PENDING',
    "image_id" TEXT,
    "image_digest" TEXT,
    "container_id" TEXT,
    "host_port" INTEGER,
    "container_port" INTEGER NOT NULL DEFAULT 8080,
    "error_message" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 3,
    "claimed_by" TEXT,
    "lease_generation" INTEGER NOT NULL DEFAULT 0,
    "lease_expires_at" TIMESTAMP(3),
    "next_retry_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    CONSTRAINT "preview_revisions_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'preview_revisions_preview_id_fkey'
      AND conrelid = '"preview_revisions"'::regclass
  ) THEN
    ALTER TABLE "preview_revisions"
      ADD CONSTRAINT "preview_revisions_preview_id_fkey"
      FOREIGN KEY ("preview_id") REFERENCES "previews"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'preview_revisions_preview_id_sequence_key'
      AND conrelid = '"preview_revisions"'::regclass
  ) THEN
    ALTER TABLE "preview_revisions"
      ADD CONSTRAINT "preview_revisions_preview_id_sequence_key" UNIQUE ("preview_id", "sequence");
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "preview_revisions_preview_id_idx" ON "preview_revisions"("preview_id");
CREATE INDEX IF NOT EXISTS "preview_revisions_status_next_retry_at_lease_expires_at_cre_idx"
  ON "preview_revisions"("status", "next_retry_at", "lease_expires_at", "created_at");
