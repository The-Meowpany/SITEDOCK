-- Add CANCELED to ServiceDeploymentStatus enum
ALTER TYPE "ServiceDeploymentStatus" ADD VALUE IF NOT EXISTS 'CANCELED';

-- Add durable queue columns to service_deployments
ALTER TABLE "service_deployments"
  ADD COLUMN IF NOT EXISTS "attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "max_attempts" INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS "claimed_by" TEXT,
  ADD COLUMN IF NOT EXISTS "lease_expires_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "next_retry_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "idempotency_key" TEXT,
  ADD COLUMN IF NOT EXISTS "canceled_at" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "service_deployments_status_idx" ON "service_deployments"("status");
CREATE UNIQUE INDEX IF NOT EXISTS "service_deployments_idempotency_key_key" ON "service_deployments"("idempotency_key");
