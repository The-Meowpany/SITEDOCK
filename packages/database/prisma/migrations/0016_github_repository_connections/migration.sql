-- M18: authorized GitHub repository connections.
--
-- The webhook resolves tenant ownership from this table; client-supplied
-- repository/website ids are never trusted. Forward-only and idempotent.

CREATE TABLE IF NOT EXISTS "github_repository_connections" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "website_id" TEXT NOT NULL,
    "service_id" TEXT,
    "installation_id" TEXT NOT NULL,
    "repository_id" TEXT NOT NULL,
    "repository_name" TEXT NOT NULL,
    "repository_full_name" TEXT NOT NULL,
    "default_branch" TEXT NOT NULL DEFAULT 'main',
    "webhook_secret" TEXT NOT NULL,
    "pinned_commit_sha" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "github_repository_connections_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'github_repository_connections_website_id_fkey'
      AND conrelid = '"github_repository_connections"'::regclass
  ) THEN
    ALTER TABLE "github_repository_connections"
      ADD CONSTRAINT "github_repository_connections_website_id_fkey"
      FOREIGN KEY ("website_id") REFERENCES "websites"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'github_repository_connections_installation_id_repository_id_key'
      AND conrelid = '"github_repository_connections"'::regclass
  ) THEN
    ALTER TABLE "github_repository_connections"
      ADD CONSTRAINT "github_repository_connections_installation_id_repository_id_key"
      UNIQUE ("installation_id", "repository_id");
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "github_repository_connections_website_id_idx"
  ON "github_repository_connections"("website_id");
CREATE INDEX IF NOT EXISTS "github_repository_connections_organization_id_idx"
  ON "github_repository_connections"("organization_id");
