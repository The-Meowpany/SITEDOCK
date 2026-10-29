/**
 * Runs before every test module in this package (Vitest `setupFiles`).
 *
 * `vitest.config.ts` injects `SITEDOCK_TEST_DATABASE_URL`/`DATABASE_URL` into
 * the worker environment, so the PrismaClient imported by the suites is already
 * bound to the dedicated test schema. This validates that boundary explicitly
 * and fails the run (fail closed) if it does not hold.
 */
import { useDedicatedTestDatabase } from "@sitedock/database";

useDedicatedTestDatabase();
