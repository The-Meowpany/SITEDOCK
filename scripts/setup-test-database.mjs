#!/usr/bin/env node
/**
 * Provisions the dedicated namespace used by the PostgreSQL integration tests.
 *
 * The test namespace is isolated by SCHEMA, not by database name: the same
 * PostgreSQL server may be shared with development, so `public` (application
 * data) is never touched from here. The Prisma model is pushed into an empty
 * dedicated schema, which is safe because the schema exists only for tests.
 */
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

const require = createRequire(import.meta.url);
const prismaCli = require.resolve("prisma/build/index.js");

const DEFAULT_TEST_DATABASE_URL =
  "postgresql://sitedock:sitedock@localhost:5432/sitedock?schema=sitedock_test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const schemaPath = path.join(root, "packages/database/prisma/schema.prisma");

const url = process.env.SITEDOCK_TEST_DATABASE_URL?.trim() || DEFAULT_TEST_DATABASE_URL;

let parsed;
try {
  parsed = new URL(url);
} catch {
  console.error("[test-db] SITEDOCK_TEST_DATABASE_URL is not a valid PostgreSQL connection URL.");
  process.exit(1);
}

const database = parsed.pathname.replace(/^\//, "");
const schema = parsed.searchParams.get("schema") ?? "public";

if (!database) {
  console.error("[test-db] the test database URL does not name a database.");
  process.exit(1);
}

if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(schema)) {
  console.error("[test-db] the test database URL contains an unsafe schema name.");
  process.exit(1);
}

if (schema === "public") {
  console.error(
    "[test-db] refusing to provision the `public` schema: it holds application data. " +
      "Point SITEDOCK_TEST_DATABASE_URL at a dedicated schema."
  );
  process.exit(1);
}

const target = `database "${database}", schema "${schema}"`;
console.log(`[test-db] target ${target}`);

// Independent verification of the target: the URL is not evidence by itself.
// Connect with it and require the server to report exactly that namespace.
const probe = new PrismaClient({ datasources: { db: { url } } });
try {
  const rows = await probe.$queryRawUnsafe(
    `SELECT current_database() AS database, current_schema() AS schema`
  );
  const live = rows?.[0];
  if (!live || live.database !== database || live.schema !== schema) {
    console.error(
      `[test-db] refusing to provision: the connection reported database "${live?.database}", ` +
        `schema "${live?.schema}", not the configured test namespace.`
    );
    process.exit(1);
  }
} finally {
  await probe.$disconnect();
}

// Ready = the schema already matches the Prisma model exactly. `migrate diff`
// exits 2 when there is drift, which is also the signal that this is a fresh
// or interrupted namespace.
const diff = spawnSync(
  process.execPath,
  [
    prismaCli,
    "migrate",
    "diff",
    "--from-url",
    url,
    "--to-schema-datamodel",
    schemaPath,
    "--exit-code",
  ],
  { cwd: root, env: { ...process.env, DATABASE_URL: url }, encoding: "utf8" }
);

if (diff.status === 0) {
  console.log("[test-db] namespace already matches the Prisma model; nothing to do.");
  process.exit(0);
}

if (diff.status !== 2) {
  console.error("[test-db] could not inspect the test namespace:");
  console.error((diff.stderr || diff.stdout || "").trim().split("\n").slice(-5).join("\n"));
  process.exit(diff.status ?? 1);
}

console.log("[test-db] provisioning the schema from the Prisma model...");

// No --accept-data-loss: if reconciling the namespace would drop data or
// columns, stop and let a human decide instead of silently destroying it.
const push = spawnSync(
  process.execPath,
  [prismaCli, "db", "push", "--skip-generate", "--schema", schemaPath],
  { cwd: root, env: { ...process.env, DATABASE_URL: url }, stdio: "inherit" }
);

if (push.status !== 0) {
  console.error(
    "[test-db] provisioning stopped (no --accept-data-loss is ever passed). " +
      "Review the drift reported above and provision the test namespace explicitly."
  );
  process.exit(push.status ?? 1);
}

const client = new PrismaClient({ datasources: { db: { url } } });
try {
  const rows = await client.$queryRawUnsafe(
    `SELECT to_regclass('"${schema}".service_deployments')::text AS relation`
  );
  if (!rows?.[0]?.relation) {
    console.error("[test-db] provisioning finished but service_deployments is still missing.");
    process.exit(1);
  }
} finally {
  await client.$disconnect();
}

console.log("[test-db] test namespace ready.");
