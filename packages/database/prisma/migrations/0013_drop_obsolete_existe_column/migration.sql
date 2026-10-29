-- Remove the accidental `existe` boolean that was added to service_deployments
-- outside of migration history. It is not part of the Prisma model in
-- schema.prisma, no application code reads or writes it, and it has no
-- default/constraint that other objects depend on.
--
-- Forward-only migration: previously applied migrations are left untouched.
ALTER TABLE "service_deployments" DROP COLUMN IF EXISTS "existe";
