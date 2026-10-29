ALTER TABLE "service_deployments" ADD COLUMN IF NOT EXISTS "lease_generation" INTEGER NOT NULL DEFAULT 0;
