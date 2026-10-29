-- M14: durable per-service-deployment logs (separate from website deployments).

CREATE TABLE "service_deployment_logs" (
    "id" TEXT NOT NULL,
    "deployment_id" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,

    CONSTRAINT "service_deployment_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "service_deployment_logs_deployment_id_idx" ON "service_deployment_logs"("deployment_id");
CREATE INDEX "service_deployment_logs_timestamp_idx" ON "service_deployment_logs"("timestamp");

ALTER TABLE "service_deployment_logs"
  ADD CONSTRAINT "service_deployment_logs_deployment_id_fkey"
  FOREIGN KEY ("deployment_id") REFERENCES "service_deployments"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
