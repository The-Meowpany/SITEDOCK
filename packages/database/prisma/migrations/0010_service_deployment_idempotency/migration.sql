-- M14: idempotency keys are scoped per service, never global/tenant-crossing.

CREATE UNIQUE INDEX "service_deployments_service_id_idempotency_key_key"
  ON "service_deployments"("service_id", "idempotency_key");
