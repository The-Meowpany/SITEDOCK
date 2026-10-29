-- M14: inline build context (base64 path -> content) so a service can be
-- built without a host Docker socket or an external source checkout.

ALTER TABLE "services" ADD COLUMN "context_files" JSONB;
