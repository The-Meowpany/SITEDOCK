#!/usr/bin/env node
/**
 * Greenfield migration verification for SiteDock.
 *
 * Proves that a database containing nothing but the tracked migrations can be
 * built with `prisma migrate deploy`, and that the result matches
 * `packages/database/prisma/schema.prisma` exactly.
 *
 * It never touches an existing application schema:
 *
 *   - it creates its own throwaway namespace (`sitedock_migtest_*`), either a
 *     database (when the role has CREATEDB) or an isolated schema;
 *   - it refuses to run against `public`, `sitedock_test`, or any namespace it
 *     did not just create and verify;
 *   - it re-checks the live connection identity before every mutation and
 *     refuses when the server does not report the expected database/schema;
 *   - cleanup only ever drops the namespace this process created, and only
 *     after re-validating its name.
 *
 * Usage:
 *   SITEDOCK_MIGRATION_TEST_ADMIN_URL=postgresql://user:pass@host:5432/postgres \
 *     node scripts/verify-migrations.mjs [--repeat N] [--keep] [--self-test]
 *
 *   --repeat N    build N independent namespaces and require equivalent schemas
 *                 (default 1; use 2 for the reproducibility check)
 *   --keep        leave the namespace behind for inspection (name is printed)
 *   --self-test   run the negative safety checks only; creates nothing
 *   --database    force database mode; fails instead of falling back to a schema
 *
 * `SITEDOCK_MIGRATION_TEST_ADMIN_URL` must be supplied explicitly so that no
 * run is ever implicit: this script mutates the server it is pointed at (by
 * creating and dropping its own namespace).
 */
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

const require = createRequire(import.meta.url);
const prismaCli = require.resolve("prisma/build/index.js");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const schemaPath = path.join(root, "packages/database/prisma/schema.prisma");
const migrationsDir = path.join(root, "packages/database/prisma/migrations");

const ADMIN_URL_ENV = "SITEDOCK_MIGRATION_TEST_ADMIN_URL";
const NAMESPACE_PREFIX = "sitedock_migtest_";
const PROTECTED_SCHEMAS = new Set(["public", "sitedock_test"]);
const SAFE_IDENTIFIER = /^[a-z_][a-z0-9_]*$/;
const NAMESPACE_PATTERN = new RegExp(`^${NAMESPACE_PREFIX}[a-z0-9_]{6,}$`);

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const valueOf = (name, fallback) => {
  const index = args.indexOf(name);
  return index === -1 || !args[index + 1] ? fallback : args[index + 1];
};

const repeat = Number.parseInt(valueOf("--repeat", "1"), 10);
const keep = flag("--keep");
const selfTest = flag("--self-test");
const requireDatabase = flag("--database");

// Shared with scripts/verify-existing-database-reconciliation.mjs: the guards
// and namespace lifecycle below are the single safety boundary for both.
export class SafetyRefusal extends Error {}

export function refuse(message) {
  throw new SafetyRefusal(message);
}

/** An unset admin URL must always be refused: no run may target an implicit server. */
export function requireAdminUrl(value) {
  const url = value?.trim();
  if (!url) {
    refuse(
      `${ADMIN_URL_ENV} is not set. Point it at a PostgreSQL server where this script may create ` +
        `and drop its own throwaway ${NAMESPACE_PREFIX}* namespace.`
    );
  }
  return url;
}

function log(message) {
  console.log(`[verify-migrations] ${message}`);
}

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, ...(options.env ?? {}) },
    timeout: options.timeout ?? 180_000,
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    signal: result.signal,
  };
}

export function prisma(prismaArgs, url) {
  return run(process.execPath, [prismaCli, ...prismaArgs], {
    env: { DATABASE_URL: url, NODE_ENV: process.env.NODE_ENV ?? "test" },
  });
}

// ── Target parsing and independent verification ─────────────────────────────

export function parseTarget(url, label) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    refuse(`${label} is not a valid PostgreSQL connection URL.`);
  }
  const database = parsed.pathname.replace(/^\//, "");
  if (!database) refuse(`${label} does not name a database.`);
  const schema = parsed.searchParams.get("schema") ?? "public";
  // Never echo the URL: it can contain credentials.
  return { host: parsed.hostname, port: parsed.port || "5432", database, schema };
}

export function assertSafeIdentifier(value, label) {
  if (typeof value !== "string" || !SAFE_IDENTIFIER.test(value)) {
    refuse(`${label} contains an unsafe identifier.`);
  }
}

export function assertNamespaceName(name) {
  if (typeof name !== "string" || !NAMESPACE_PATTERN.test(name)) {
    refuse(`refusing to operate on "${name}": it is not a ${NAMESPACE_PREFIX}* verification namespace.`);
  }
  if (PROTECTED_SCHEMAS.has(name)) {
    refuse(`refusing to operate on protected schema "${name}".`);
  }
}

/** A namespace may only be mutated/dropped by the run that created and verified it. */
export function assertOwnedNamespace(namespace) {
  if (!namespace || namespace.createdByUs !== true) {
    refuse("refusing to operate on a namespace this process did not create.");
  }
  assertNamespaceName(namespace.name);
}

/**
 * The only schema a run may migrate is the namespace it just created. `public`
 * is allowed only inside a database this run created for itself.
 */
export function assertMigrationTarget(namespace, target) {
  assertOwnedNamespace(namespace);
  if (target.schema === "public") {
    if (namespace.kind !== "database") {
      refuse(
        "refusing to migrate the `public` schema of a shared database: it holds application data. " +
          "Only a database created for this run may use `public`."
      );
    }
    return;
  }
  if (target.schema !== namespace.name) {
    refuse(
      `refusing to migrate schema "${target.schema}": this run created "${namespace.name}" and ` +
        "nothing else."
    );
  }
}

export async function probe(url) {
  const client = new PrismaClient({ datasources: { db: { url } } });
  try {
    const rows = await client.$queryRawUnsafe(
      `SELECT current_database() AS database, current_schema() AS schema, current_user AS "user"`
    );
    return rows[0];
  } finally {
    await client.$disconnect();
  }
}

/** Runs SQL in the admin connection, but only after the live identity matches. */
export async function adminQuery(adminUrl, expected, sql) {
  const client = new PrismaClient({ datasources: { db: { url: adminUrl } } });
  try {
    const rows = await client.$queryRawUnsafe(
      `SELECT current_database() AS database, current_schema() AS schema`
    );
    const live = rows[0];
    if (!live || live.database !== expected.database) {
      refuse(
        `refusing to issue SQL: the admin connection reported database "${live?.database}", ` +
          `not the configured "${expected.database}".`
      );
    }
    return await client.$queryRawUnsafe(sql.text, ...(sql.values ?? []));
  } finally {
    await client.$disconnect();
  }
}

// ── Namespace lifecycle ─────────────────────────────────────────────────────

export function namespaceUrl(adminUrl, kind, name) {
  const parsed = new URL(adminUrl);
  if (kind === "database") {
    parsed.pathname = `/${name}`;
    parsed.searchParams.delete("schema");
    return parsed.toString();
  }
  parsed.pathname = `/${parsed.pathname.replace(/^\//, "")}`;
  parsed.searchParams.set("schema", name);
  return parsed.toString();
}

export async function createNamespace(adminUrl, adminTarget, kind) {
  const name = `${NAMESPACE_PREFIX}${crypto.randomBytes(6).toString("hex")}`;
  if (!NAMESPACE_PATTERN.test(name)) refuse(`generated namespace "${name}" is not a valid identifier.`);

  if (kind === "database") {
    const existing = await adminQuery(adminUrl, adminTarget, {
      text: "SELECT datname FROM pg_database WHERE datname = $1",
      values: [name],
    });
    if (existing.length > 0) refuse(`database "${name}" already exists; refusing to reuse it.`);
  } else {
    const existing = await adminQuery(adminUrl, adminTarget, {
      text: "SELECT nspname FROM pg_namespace WHERE nspname = $1",
      values: [name],
    });
    if (existing.length > 0) refuse(`schema "${name}" already exists; refusing to reuse it.`);
  }

  if (kind === "database") {
    await adminQuery(adminUrl, adminTarget, {
      text: `CREATE DATABASE "${name}"`,
    });
  } else {
    await adminQuery(adminUrl, adminTarget, {
      text: `CREATE SCHEMA "${name}"`,
    });
  }

  return { kind, name, url: namespaceUrl(adminUrl, kind, name), createdByUs: true };
}

export async function dropNamespace(adminUrl, adminTarget, namespace) {
  // Cleanup is the most dangerous step: validate ownership and scope again.
  assertOwnedNamespace(namespace);
  if (namespace.kind === "database") {
    await adminQuery(adminUrl, adminTarget, { text: `DROP DATABASE IF EXISTS "${namespace.name}"` });
  } else {
    await adminQuery(adminUrl, adminTarget, { text: `DROP SCHEMA IF EXISTS "${namespace.name}" CASCADE` });
  }
}

/** A namespace is usable only if it is empty of application state. */
export async function assertEmptyNamespace(url, expectedSchema, namespace) {
  const target = parseTarget(url, "migration target");
  assertSafeIdentifier(target.database, "migration target");
  assertMigrationTarget(namespace, target);
  const client = new PrismaClient({ datasources: { db: { url } } });
  try {
    const identity = await client.$queryRawUnsafe(
      `SELECT current_database() AS database, current_schema() AS schema`
    );
    const live = identity[0];
    if (!live || live.schema !== expectedSchema) {
      refuse(
        `refusing to migrate: the live connection reports schema "${live?.schema}", ` +
          `not the namespace "${expectedSchema}" this run created.`
      );
    }
    if (namespace.kind === "database" && live.database !== namespace.name) {
      refuse(
        `refusing to migrate: the live connection reports database "${live.database}", ` +
          `not the database "${namespace.name}" this run created.`
      );
    }
    const tables = await client.$queryRawUnsafe(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = $1`,
      expectedSchema
    );
    if (tables.length > 0) {
      refuse(
        `refusing to migrate: the namespace is not empty (${tables
          .map((row) => row.table_name)
          .join(", ")}). A greenfield test requires a namespace with no tables.`
      );
    }
  } finally {
    await client.$disconnect();
  }
}

// ── Verification ────────────────────────────────────────────────────────────

const EXPECTED_TABLES = [
  "organizations",
  "organization_members",
  "account_organizations",
  "environments",
  "service_deployments",
  "service_deployment_logs",
  "container_instances",
  "websites",
  "projects",
  "services",
];

const EXPECTED_ENUMS = {
  OrganizationRole: ["OWNER", "ORGANIZATION_ADMINISTRATOR", "ADMINISTRATOR", "DEVELOPER", "OPERATOR", "ANALYST", "VIEWER"],
  EnvironmentType: ["PRODUCTION", "STAGING", "DEVELOPMENT", "BRANCH_PREVIEW", "PR_PREVIEW"],
  EnvironmentStatus: ["ACTIVE", "INACTIVE", "ARCHIVED"],
  DeploymentStatus: ["QUEUED", "BUILDING", "READY", "PUBLISHED", "FAILED", "CANCELED"],
};

const EXPECTED_CONSTRAINTS = [
  "organizations_pkey",
  "organization_members_organization_id_fkey",
  "organization_members_user_id_fkey",
  "account_organizations_account_id_fkey",
  "account_organizations_organization_id_fkey",
  "projects_organization_id_fkey",
  "websites_organization_id_fkey",
  "environments_project_id_fkey",
  "services_environment_id_fkey",
  "container_instances_service_id_fkey",
  "service_deployment_logs_deployment_id_fkey",
];

const FORBIDDEN_RELATIONS = ["deployment_logs"];

function migrationDirectories() {
  const fs = require("node:fs");
  return fs
    .readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

export async function readSchema(url, schema) {
  const client = new PrismaClient({ datasources: { db: { url } } });
  try {
    const tables = await client.$queryRawUnsafe(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_name`,
      schema
    );
    const columns = await client.$queryRawUnsafe(
      `SELECT table_name, column_name, data_type, is_nullable
         FROM information_schema.columns
        WHERE table_schema = $1
        ORDER BY table_name, column_name`,
      schema
    );
    const enums = await client.$queryRawUnsafe(
      `SELECT t.typname AS name, e.enumlabel AS label
         FROM pg_type t
         JOIN pg_namespace n ON n.oid = t.typnamespace
         JOIN pg_enum e ON e.enumtypid = t.oid
        WHERE n.nspname = $1
        ORDER BY t.typname, e.enumsortorder`,
      schema
    );
    const indexes = await client.$queryRawUnsafe(
      `SELECT indexname FROM pg_indexes WHERE schemaname = $1 ORDER BY indexname`,
      schema
    );
    const constraints = await client.$queryRawUnsafe(
      `SELECT conname FROM pg_constraint c
         JOIN pg_class t ON t.oid = c.conrelid
         JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = $1
        ORDER BY conname`,
      schema
    );
    return {
      tables: tables.map((row) => row.table_name),
      columns: columns.map((row) => `${row.table_name}.${row.column_name}:${row.data_type}:${row.is_nullable}`),
      enums,
      indexes: indexes.map((row) => row.indexname),
      constraints: constraints.map((row) => row.conname),
    };
  } finally {
    await client.$disconnect();
  }
}

async function verifyMigratedNamespace(url, schema) {
  const failures = [];

  const status = prisma(["migrate", "status", "--schema", schemaPath], url);
  if (status.status !== 0 || !/up to date/i.test(status.stdout + status.stderr)) {
    failures.push(`migrate status did not report a clean history:\n${(status.stdout + status.stderr).trim()}`);
  }

  const diff = prisma(
    ["migrate", "diff", "--from-url", url, "--to-schema-datamodel", schemaPath, "--exit-code"],
    url
  );
  if (diff.status !== 0) {
    failures.push(
      `the migrated schema drifts from schema.prisma (migrate diff exit ${diff.status}):\n${(
        diff.stdout + diff.stderr
      ).trim()}`
    );
  }

  const state = await readSchema(url, schema);

  // 1. No object may be missing a tracked creation path — drift above proves
  //    the whole model, these checks give actionable names.
  for (const table of EXPECTED_TABLES) {
    if (!state.tables.includes(table)) failures.push(`expected table "${table}" is missing`);
  }
  for (const relation of FORBIDDEN_RELATIONS) {
    if (state.tables.includes(relation)) failures.push(`legacy relation "${relation}" still exists`);
  }
  for (const [name, labels] of Object.entries(EXPECTED_ENUMS)) {
    const actual = state.enums.filter((row) => row.name === name).map((row) => row.label);
    if (actual.length === 0) {
      failures.push(`expected enum "${name}" is missing`);
      continue;
    }
    if (actual.join(",") !== labels.join(",")) {
      failures.push(`enum "${name}" is [${actual.join(", ")}], expected [${labels.join(", ")}]`);
    }
  }
  for (const constraint of EXPECTED_CONSTRAINTS) {
    if (!state.constraints.includes(constraint)) failures.push(`expected constraint "${constraint}" is missing`);
  }

  // 2. The history must be self-sufficient: one executed record per directory
  //    and no zero-step record (which is what `migrate resolve` leaves behind).
  const directories = migrationDirectories();
  const client = new PrismaClient({ datasources: { db: { url } } });
  try {
    const records = await client.$queryRawUnsafe(
      `SELECT migration_name, applied_steps_count, finished_at, rolled_back_at
         FROM "${schema}"."_prisma_migrations"
         ORDER BY started_at, migration_name`
    );
    const appliedNames = records.map((row) => row.migration_name);
    if (appliedNames.length !== directories.length) {
      failures.push(
        `history has ${appliedNames.length} records for ${directories.length} migration directories`
      );
    }
    const missing = directories.filter((name) => !appliedNames.includes(name));
    if (missing.length > 0) failures.push(`migrations without a history record: ${missing.join(", ")}`);
    for (const record of records) {
      if (record.rolled_back_at) failures.push(`migration "${record.migration_name}" is rolled back`);
      if (!record.finished_at) failures.push(`migration "${record.migration_name}" did not finish`);
      if (record.applied_steps_count === 0) {
        failures.push(
          `migration "${record.migration_name}" is recorded with applied_steps_count = 0 ` +
            `(marked applied without being executed); a greenfield build requires every migration to run`
        );
      }
    }
  } finally {
    await client.$disconnect();
  }

  return { failures, state, directories };
}

export function fingerprint(state) {
  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        tables: state.tables,
        columns: state.columns,
        enums: state.enums,
        indexes: state.indexes,
        constraints: state.constraints,
      })
    )
    .digest("hex");
}

// ── Negative safety checks ──────────────────────────────────────────────────

async function runSelfTest() {
  const results = [];
  const expectRefusal = async (label, action) => {
    try {
      await action();
      results.push({ label, ok: false, detail: "was ACCEPTED but must be refused" });
    } catch (error) {
      if (error instanceof SafetyRefusal) {
        results.push({ label, ok: true, detail: error.message });
      } else {
        results.push({ label, ok: false, detail: `failed with an unexpected error: ${error.message}` });
      }
    }
  };

  const expectAccepted = (label, action) => {
    try {
      action();
      results.push({ label, ok: true, detail: "accepted, as required" });
    } catch (error) {
      results.push({ label, ok: false, detail: `was REFUSED but must be accepted: ${error.message}` });
    }
  };

  const selfSchema = `${NAMESPACE_PREFIX}abc123def456`;
  const selfDatabase = { kind: "database", name: selfSchema, createdByUs: true };
  const selfSchemaNs = { kind: "schema", name: selfSchema, createdByUs: true };

  await expectRefusal("missing target URL", async () => requireAdminUrl(undefined));
  await expectRefusal("blank target URL", async () => requireAdminUrl("   "));
  await expectAccepted("configured target URL", () => requireAdminUrl("postgresql://user@localhost:5432/db"));
  await expectRefusal("invalid URL", async () => parseTarget("not-a-url", "target"));
  await expectRefusal("URL without a database", async () => parseTarget("postgresql://user@localhost:5432/", "target"));
  await expectRefusal("namespace outside the verifier prefix", async () => assertNamespaceName("public"));
  await expectRefusal("protected schema name", async () => assertNamespaceName("sitedock_test"));
  await expectRefusal("drop without ownership", async () =>
    assertOwnedNamespace({ kind: "schema", name: selfSchema, createdByUs: false })
  );
  await expectRefusal("drop with a forged name", async () =>
    assertOwnedNamespace({ kind: "schema", name: "public", createdByUs: true })
  );
  await expectRefusal("public schema inside a shared database", async () =>
    assertMigrationTarget(selfSchemaNs, { database: "sitedock", schema: "public" })
  );
  await expectRefusal("application schema of a shared database", async () =>
    assertMigrationTarget(selfSchemaNs, { database: "sitedock", schema: "sitedock_test" })
  );
  await expectRefusal("another run's namespace", async () =>
    assertMigrationTarget(selfSchemaNs, { database: "sitedock", schema: `${NAMESPACE_PREFIX}ffffffffffff` })
  );
  await expectAccepted("public schema of a database this run created", () =>
    assertMigrationTarget(selfDatabase, { database: selfSchema, schema: "public" })
  );
  await expectAccepted("the run's own schema", () =>
    assertMigrationTarget(selfSchemaNs, { database: "sitedock", schema: selfSchema })
  );

  const failed = results.filter((result) => !result.ok);
  for (const result of results) {
    log(`${result.ok ? "PASS" : "FAIL"}  ${result.label}: ${result.detail}`);
  }
  if (failed.length > 0) {
    throw new Error(`${failed.length} safety check(s) did not behave as required`);
  }
  log(`${results.length} negative and positive safety checks behaved as required`);
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  if (!Number.isInteger(repeat) || repeat < 1 || repeat > 5) refuse("--repeat must be between 1 and 5.");

  const adminUrl = process.env[ADMIN_URL_ENV]?.trim();

  if (selfTest) {
    await runSelfTest();
    return;
  }

  requireAdminUrl(adminUrl);
  if (process.env.NODE_ENV === "production") refuse("refusing to run destructive verification with NODE_ENV=production.");

  const adminTarget = parseTarget(adminUrl, ADMIN_URL_ENV);
  assertSafeIdentifier(adminTarget.database, ADMIN_URL_ENV);
  if (adminTarget.schema !== "public") {
    refuse(
      `${ADMIN_URL_ENV} names schema "${adminTarget.schema}". The admin connection must not select an ` +
        `application schema; omit the schema parameter.`
    );
  }

  const live = await probe(adminUrl);
  if (!live || live.database !== adminTarget.database) {
    refuse(
      `the admin connection reported database "${live?.database}", which is not the configured ` +
        `"${adminTarget.database}".`
    );
  }
  log(`admin target: ${adminTarget.host}:${adminTarget.port} database "${adminTarget.database}" user "${live.user}"`);

  const canCreateDatabase = await adminQuery(adminUrl, adminTarget, {
    text: "SELECT rolcreatedb OR rolsuper AS allowed FROM pg_roles WHERE rolname = current_user",
  });
  const databaseMode = Boolean(canCreateDatabase[0]?.allowed);
  if (!databaseMode && requireDatabase) {
    refuse("--database was requested but the current role cannot create databases on this server.");
  }
  const kind = databaseMode ? "database" : "schema";
  if (!databaseMode) {
    log("role cannot create databases; isolating each run in a dedicated schema instead");
  }

  const fingerprints = [];
  const failures = [];

  for (let runIndex = 1; runIndex <= repeat; runIndex += 1) {
    const namespace = await createNamespace(adminUrl, adminTarget, kind);
    log(`run ${runIndex}/${repeat}: created ${namespace.kind} "${namespace.name}"`);

    try {
      const expectedSchema = namespace.kind === "database" ? "public" : namespace.name;
      await assertEmptyNamespace(namespace.url, expectedSchema, namespace);

      const deploy = prisma(["migrate", "deploy", "--schema", schemaPath], namespace.url);
      log(`run ${runIndex}: prisma migrate deploy exited ${deploy.status}`);
      if (deploy.status !== 0) {
        failures.push(`run ${runIndex}: migrate deploy failed:\n${(deploy.stdout + deploy.stderr).trim()}`);
        continue;
      }

      const { failures: runFailures, state } = await verifyMigratedNamespace(namespace.url, expectedSchema);
      failures.push(...runFailures.map((failure) => `run ${runIndex}: ${failure}`));
      fingerprints.push({ runIndex, fingerprint: fingerprint(state), tables: state.tables.length });
      log(
        `run ${runIndex}: tables=${state.tables.length} enums=${
          new Set(state.enums.map((row) => row.name)).size
        } indexes=${state.indexes.length} constraints=${state.constraints.length}`
      );

      // Re-running migrate deploy must be a no-op, never a second application.
      const again = prisma(["migrate", "deploy", "--schema", schemaPath], namespace.url);
      if (again.status !== 0 || !/no pending migrations/i.test(again.stdout + again.stderr)) {
        failures.push(
          `run ${runIndex}: a second migrate deploy was not a no-op:\n${(again.stdout + again.stderr).trim()}`
        );
      }
    } finally {
      if (keep) {
        log(`kept ${namespace.kind} "${namespace.name}" (--keep)`);
      } else {
        await dropNamespace(adminUrl, adminTarget, namespace);
        log(`run ${runIndex}: dropped ${namespace.kind} "${namespace.name}"`);
      }
    }
  }

  if (fingerprints.length > 1) {
    const [first, ...rest] = fingerprints;
    for (const other of rest) {
      if (other.fingerprint !== first.fingerprint) {
        failures.push(
          `run ${other.runIndex} produced a different schema fingerprint than run ${first.runIndex}`
        );
      }
    }
    log(`reproducibility: ${fingerprints.length} independent builds, schema fingerprints compared`);
  }

  if (failures.length > 0) {
    for (const failure of failures) console.error(`[verify-migrations] FAIL ${failure}`);
    process.exitCode = 1;
    return;
  }
  log(`PASS greenfield migration chain is reproducible from an empty namespace (${repeat} run(s))`);
}

// Importing this module (the reconciliation verifier does) must not start a run.
const isDirectRun = Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  main().catch((error) => {
    if (error instanceof SafetyRefusal) {
      console.error(`[verify-migrations] REFUSED ${error.message}`);
    } else {
      console.error(`[verify-migrations] ERROR ${error.message}`);
    }
    process.exitCode = 1;
  });
}
