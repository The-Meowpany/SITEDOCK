-- Custom-domain lifecycle: provider ownership, DNS instructions/state, routing
-- verification and SSL health. Forward-only; existing rows keep working with
-- safe defaults (manual provider, no SSL, routing unknown).

ALTER TABLE "domains"
  ADD COLUMN "service_id" TEXT,
  ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN "provider_record_id" TEXT,
  ADD COLUMN "dns_record_type" TEXT,
  ADD COLUMN "dns_record_name" TEXT,
  ADD COLUMN "dns_record_value" TEXT,
  ADD COLUMN "auto_managed" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "routing_ok" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "routing_checked_at" TIMESTAMP(3),
  ADD COLUMN "routing_observed" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "last_error" TEXT,
  ADD COLUMN "verification_attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "ssl_status" TEXT NOT NULL DEFAULT 'NONE',
  ADD COLUMN "ssl_error" TEXT;

ALTER TABLE "domains"
  ADD CONSTRAINT "domains_service_id_fkey"
  FOREIGN KEY ("service_id") REFERENCES "services"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "domains_service_id_idx" ON "domains"("service_id");
CREATE INDEX "domains_status_idx" ON "domains"("status");

-- GitHub Apps use one global webhook secret (GITHUB_APP_WEBHOOK_SECRET), not a
-- per-connection copy. The column is no longer required for new connections.
ALTER TABLE "github_repository_connections" ALTER COLUMN "webhook_secret" DROP NOT NULL;
