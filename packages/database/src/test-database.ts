/**
 * Fail-closed boundary for integration tests that write to PostgreSQL.
 *
 * The test suite shares a PostgreSQL server with development and can reach
 * production with the same credentials, so "the database name contains test"
 * is not a safety guarantee. Instead every integration suite must:
 *
 *   1. be pointed at an explicitly configured, dedicated test namespace
 *      (`SITEDOCK_TEST_DATABASE_URL`, never the public schema used by the app);
 *   2. prove at runtime that the live connection really landed in that
 *      namespace before any fixture is written or removed.
 *
 * `useDedicatedTestDatabase()` runs in the Vitest setup file, before any test
 * module (and therefore before the shared PrismaClient) is imported.
 * `assertDedicatedTestDatabase()` runs in each suite's `beforeAll`, before any
 * destructive fixture setup.
 */

export const TEST_DATABASE_URL_ENV = "SITEDOCK_TEST_DATABASE_URL";

/**
 * Local development default. It is the same server/credentials as the app's
 * development URL but a dedicated schema, so test rows can never be visible to,
 * or collide with, development data.
 */
export const DEFAULT_TEST_DATABASE_URL =
  "postgresql://sitedock:sitedock@localhost:5432/sitedock?schema=sitedock_test";

const SAFE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

type RawQueryClient = {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
};

type ConnectionTarget = { database: string; schema: string };

function fail(message: string): never {
  // Never echo the configured URL: it may contain credentials.
  throw new Error(`[test-database-guard] ${message}`);
}

function parseTarget(url: string): ConnectionTarget {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    fail(`${TEST_DATABASE_URL_ENV} is not a valid PostgreSQL connection URL.`);
  }
  const database = parsed.pathname.replace(/^\//, "");
  if (!database) fail(`${TEST_DATABASE_URL_ENV} does not name a database.`);
  const schema = parsed.searchParams.get("schema") ?? "public";
  if (!SAFE_IDENTIFIER.test(schema)) {
    fail(`${TEST_DATABASE_URL_ENV} contains an unsafe schema name.`);
  }
  return { database, schema };
}

/** Resolves the configured test URL without ever falling back to the app URL. */
function readConfiguredTestUrl(): string {
  const url = process.env[TEST_DATABASE_URL_ENV]?.trim();
  if (!url) {
    fail(`${TEST_DATABASE_URL_ENV} is not set. Destructive integration tests refuse to run against an unverified database.`);
  }
  return url;
}

/**
 * Routes the process at the dedicated test namespace. Called from the Vitest
 * setup file so `process.env.DATABASE_URL` is correct before the PrismaClient
 * module is evaluated.
 */
export function useDedicatedTestDatabase(): void {
  const url = readConfiguredTestUrl();
  const { database, schema } = parseTarget(url);
  if (schema === "public") {
    fail("the test database URL must target a dedicated schema, not `public` (that schema holds application data).");
  }
  process.env.DATABASE_URL = url;
  if (process.env.NODE_ENV === "production") {
    fail("refusing to run destructive integration tests with NODE_ENV=production.");
  }
  console.info(`[test-database] integration tests target database "${database}", schema "${schema}"`);
}

/**
 * Verifies, against a live connection, that the process cannot read or write
 * application data. Throws (fail closed) when anything does not line up.
 */
export async function assertDedicatedTestDatabase(
  client: RawQueryClient,
  suite: string
): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    fail(`refusing to run destructive integration tests with NODE_ENV=production (${suite}).`);
  }

  const url = readConfiguredTestUrl();
  if (process.env.DATABASE_URL !== url) {
    fail(
      `${suite}: process DATABASE_URL is not the configured test database. ` +
        `The Vitest setup file must call useDedicatedTestDatabase() before any test module loads.`
    );
  }

  const { database, schema } = parseTarget(url);
  if (schema === "public") {
    fail(`${suite}: refusing to run against the \`public\` schema.`);
  }

  const connections = await client.$queryRawUnsafe<Array<{ database: string; schema: string }>>(
    `SELECT current_database() AS database, current_schema() AS schema`
  );
  const live = connections[0];
  if (!live) fail(`${suite}: could not read the live database identity.`);
  if (live.database !== database || live.schema !== schema) {
    fail(
      `${suite}: live connection is database "${live.database}", schema "${live.schema}", ` +
        `which is not the configured test namespace.`
    );
  }

  const relations = await client.$queryRawUnsafe<Array<{ relation: string | null }>>(
    `SELECT to_regclass('"${schema}".service_deployments')::text AS relation`
  );
  if (!relations[0]?.relation) {
    fail(
      `${suite}: the test namespace is not provisioned (missing ${schema}.service_deployments). ` +
        `Run: npm run db:test:setup`
    );
  }
}
