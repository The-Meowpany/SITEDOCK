import { defineConfig } from "vitest/config";

const testDatabaseUrl = process.env.SITEDOCK_TEST_DATABASE_URL;

export default defineConfig({
  test: {
    environment: "node",
    env: testDatabaseUrl ? { DATABASE_URL: testDatabaseUrl } : {},
    setupFiles: ["./src/__tests__/setup.ts"],
    // The durable queue (`claimNext` / `claimNextRevision`) is intentionally
    // global: it claims the oldest eligible deployment regardless of which test
    // suite created it (see src/__tests__/support/test-fixtures.ts). The
    // integration suites also share one database schema and one of them purges
    // stale fixture workspaces on start. Running test files in parallel lets one
    // suite steal another's claims or delete its fixtures mid-run
    // ("Service ... not found").
    //
    // Vitest 4 removed `poolOptions` (including `forks.singleFork`), so the old
    // setting was silently ignored and files ran in parallel. `fileParallelism:
    // false` is the supported way to run test files one at a time.
    pool: "forks",
    fileParallelism: false,
  },
});
