import { TEST_DATABASE_URL_ENV, useDedicatedTestDatabase } from "@sitedock/database";

// The Vitest config injects DATABASE_URL from SITEDOCK_TEST_DATABASE_URL before
// modules load; this validates it fail-closed and refuses `public`.
if (process.env[TEST_DATABASE_URL_ENV]) {
  useDedicatedTestDatabase();
}
