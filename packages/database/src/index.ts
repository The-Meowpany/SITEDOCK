/** Core database client and test utilities for the modular monolith. */
export { prisma, Prisma } from "./client";

/** Test database guard utilities – always configured for a dedicated test namespace. */
export { useDedicatedTestDatabase, assertDedicatedTestDatabase, TEST_DATABASE_URL_ENV, DEFAULT_TEST_DATABASE_URL } from "./test-database";