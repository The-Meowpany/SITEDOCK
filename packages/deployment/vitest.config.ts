import { defineConfig } from "vitest/config";

const testDatabaseUrl = process.env.SITEDOCK_TEST_DATABASE_URL;

export default defineConfig({
  test: {
    environment: "node",
    env: testDatabaseUrl ? { DATABASE_URL: testDatabaseUrl } : {},
    setupFiles: ["./src/__tests__/setup.ts"],
    // The durable queue (`claimNext` / `claimNextRevision`) is intentionally
    // global: it claims the oldest eligible deployment regardless of which test
    // suite created it (see src/__tests__/support/test-fixtures.ts). Running
    // these suites in parallel lets one suite's QUEUED rows steal claims from
    // another's, producing intermittent failures (e.g. "expected 2 claims,
    // observed 1"). Force a single fork so every suite runs sequentially and
    // has exclusive access to the shared test queue.
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
  },
});
