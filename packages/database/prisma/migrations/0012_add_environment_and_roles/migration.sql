-- Add environment enums
CREATE TYPE "EnvironmentType" AS ENUM ('PRODUCTION', 'STAGING', 'DEVELOPMENT', 'BRANCH_PREVIEW', 'PR_PREVIEW');
CREATE TYPE "EnvironmentStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ARCHIVED');

-- Update platform roles
ALTER TYPE "PlatformRole" ADD VALUE IF NOT EXISTS 'PLATFORM_SUPPORT';

-- Update organization roles
ALTER TYPE "OrganizationRole" ADD VALUE IF NOT EXISTS 'ORGANIZATION_ADMINISTRATOR';
ALTER TYPE "OrganizationRole" ADD VALUE IF NOT EXISTS 'OPERATOR';
ALTER TYPE "OrganizationRole" ADD VALUE IF NOT EXISTS 'ANALYST';

-- Create environments table
CREATE TABLE "environments" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "type" "EnvironmentType" NOT NULL DEFAULT 'DEVELOPMENT',
    "status" "EnvironmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "branch" TEXT,
    "pull_request" INTEGER,
    "env" JSONB,
    "secrets" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "environments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "environments_project_id_slug_key" ON "environments"("project_id", "slug");
CREATE INDEX "environments_project_id_idx" ON "environments"("project_id");

ALTER TABLE "environments" ADD CONSTRAINT "environments_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Modify projects
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;
UPDATE "projects" SET "updated_at" = CURRENT_TIMESTAMP WHERE "updated_at" IS NULL;
ALTER TABLE "projects" ALTER COLUMN "updated_at" SET NOT NULL;
ALTER TABLE "projects" ALTER COLUMN "organization_id" DROP NOT NULL;

-- Modify services
ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "environment_id" TEXT;
ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "secrets" JSONB;
CREATE INDEX IF NOT EXISTS "services_environment_id_idx" ON "services"("environment_id");
ALTER TABLE "services" ADD CONSTRAINT "services_environment_id_fkey" FOREIGN KEY ("environment_id") REFERENCES "environments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
