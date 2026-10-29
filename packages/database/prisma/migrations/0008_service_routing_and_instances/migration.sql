-- M14: authoritative hostname routing + one active deployment per service
-- and durable container-instance identity.

ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "hostname" TEXT;
UPDATE "services" SET "hostname" = "id" WHERE "hostname" IS NULL;
ALTER TABLE "services" ALTER COLUMN "hostname" SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "services_hostname_key" ON "services"("hostname");

ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "active_deployment_id" TEXT;

ALTER TABLE "container_instances" ADD COLUMN IF NOT EXISTS "service_id" TEXT;
UPDATE "container_instances" ci
SET "service_id" = sd."service_id"
FROM "service_deployments" sd
WHERE sd."id" = ci."deployment_id" AND ci."service_id" IS NULL;
ALTER TABLE "container_instances" ALTER COLUMN "service_id" SET NOT NULL;
CREATE INDEX IF NOT EXISTS "container_instances_service_id_idx" ON "container_instances"("service_id");
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'container_instances_service_id_fkey'
  ) THEN
    ALTER TABLE "container_instances"
      ADD CONSTRAINT "container_instances_service_id_fkey"
      FOREIGN KEY ("service_id") REFERENCES "services"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "service_deployments_service_id_version_key"
  ON "service_deployments"("service_id", "version");

CREATE INDEX IF NOT EXISTS "service_deployments_claim_idx"
  ON "service_deployments"("status", "next_retry_at", "lease_expires_at", "created_at");
