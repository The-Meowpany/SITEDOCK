#!/usr/bin/env node
/**
 * Existing-installation reconciliation verification.
 *
 * The development and test databases are not in a greenfield state: their
 * history was produced by running 0001–0011, then shaping the rest of the schema
 * with `prisma db push`, then recording `0012_add_environment_and_roles` with
 * `prisma migrate resolve --applied` (a zero-step, i.e. never executed, record)
 * and finally executing `0013`.
 *
 * This script rebuilds exactly that state inside a throwaway namespace, seeds
 * representative business data, and then runs the real `prisma migrate deploy`
 * against it. It asserts that:
 *
 *   - the fixture matches schema.prisma before the deploy (otherwise the test
 *     would be meaningless);
 *   - 0006_organization_domain_repair and 0014_reconcile_model_drift apply as
 *     pure no-ops: the schema fingerprint does not change;
 *   - every row of every table is byte-identical afterwards (per-table content
 *     hashes), so no data was deleted, rewritten or migrated;
 *   - the history becomes coherent (one executed record per directory, the
 *     pre-existing zero-step record for 0012 preserved as evidence, not
 *     rewritten);
 *   - a second `migrate deploy` is a no-op and the resulting schema still
 *     matches schema.prisma.
 *
 * Safety: it uses the same fail-closed namespace guards as
 * scripts/verify-migrations.mjs (own `sitedock_migtest_*` namespace only,
 * verified live connection, ownership-checked cleanup) and never touches
 * `public`, `sitedock_test`, or any database that already contains application
 * data.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import {
  SafetyRefusal,
  refuse,
  parseTarget,
  assertSafeIdentifier,
  assertMigrationTarget,
  adminQuery,
  createNamespace,
  dropNamespace,
  probe,
  prisma,
  readSchema,
  fingerprint,
  requireAdminUrl,
} from "./verify-migrations.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const schemaPath = path.join(root, "packages/database/prisma/schema.prisma");
const migrationsDir = path.join(root, "packages/database/prisma/migrations");
const ADMIN_URL_ENV = "SITEDOCK_MIGRATION_TEST_ADMIN_URL";

// Migrations that the observed installations actually executed. The missing
// pieces are 0012 (recorded, never executed) and the two repair migrations
// added on 2026-10-24.
const LEGACY_EXECUTED = [
  "0001_init",
  "0002_deployment_logs",
  "0003_dynamic_deployments",
  "0004_durable_queue",
  "0005_lease_fencing",
  "0007_fix_deployment_logs_fk",
  "0008_service_routing_and_instances",
  "0009_service_deployment_logs",
  "0010_service_deployment_idempotency",
  "0011_service_build_context",
  "0013_drop_obsolete_existe_column",
];
const LEGACY_RESOLVED = "0012_add_environment_and_roles";
const REPAIR_MIGRATIONS = ["0006_organization_domain_repair", "0014_reconcile_model_drift"];
// The installations were observed — and the repair migrations authored —
// against the model as of 0014. Later migrations (0015+) change that model for
// real (e.g. 0017 relaxes websites.organization_id), so the fixture must be
// shaped to the 0014 model, not to today's schema.prisma.
const OBSERVED_MODEL_MIGRATIONS = [...LEGACY_EXECUTED, LEGACY_RESOLVED, ...REPAIR_MIGRATIONS].sort();

const args = process.argv.slice(2);
const keep = args.includes("--keep");

function log(message) {
  console.log(`[verify-reconciliation] ${message}`);
}

function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function copyMigration(name, targetMigrationsDir) {
  const source = path.join(migrationsDir, name);
  if (!fs.existsSync(path.join(source, "migration.sql"))) {
    refuse(`migration directory "${name}" does not exist in the repository.`);
  }
  fs.cpSync(source, path.join(targetMigrationsDir, name), { recursive: true });
}

/** A throwaway Prisma project: the schema file plus the given migrations. */
function migrationWorkspace(prefix, names) {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const schemaFile = path.join(workspace, "schema.prisma");
  fs.mkdirSync(path.join(workspace, "migrations"));
  fs.copyFileSync(schemaPath, schemaFile);
  const lock = path.join(migrationsDir, "migration_lock.toml");
  if (fs.existsSync(lock)) fs.copyFileSync(lock, path.join(workspace, "migrations", "migration_lock.toml"));
  for (const name of names) copyMigration(name, path.join(workspace, "migrations"));
  return { workspace, schemaFile };
}

/**
 * Recreates the observed existing-installation state (schema + history).
 * `observed` is an empty sibling namespace used to materialise the 0014 model
 * that `prisma db push` produced on the real databases.
 */
async function buildLegacyFixture(namespace, observed) {
  const legacy = migrationWorkspace("sitedock-legacy-fixture-", LEGACY_EXECUTED);
  const model = migrationWorkspace("sitedock-observed-model-", OBSERVED_MODEL_MIGRATIONS);
  try {
    // 1. Execute the migrations the observed installations executed.
    const deployLegacy = prisma(["migrate", "deploy", "--schema", legacy.schemaFile], namespace.url);
    if (deployLegacy.status !== 0) {
      throw new Error(`could not build the legacy fixture:\n${(deployLegacy.stdout + deployLegacy.stderr).trim()}`);
    }

    // 2. Shape the rest of the schema out of band, exactly as `prisma db push`
    //    did on the real databases, to the model those databases had (0014).
    //    Safe only because both namespaces are disposable and were created by
    //    this run.
    const deployModel = prisma(["migrate", "deploy", "--schema", model.schemaFile], observed.url);
    if (deployModel.status !== 0) {
      throw new Error(`could not materialise the observed model:\n${(deployModel.stdout + deployModel.stderr).trim()}`);
    }
    const shape = prisma(
      ["migrate", "diff", "--from-url", namespace.url, "--to-url", observed.url, "--script"],
      namespace.url
    );
    if (shape.status !== 0) {
      throw new Error(`could not compute the out-of-band shape:\n${(shape.stdout + shape.stderr).trim()}`);
    }
    const shapeFile = path.join(legacy.workspace, "out-of-band.sql");
    fs.writeFileSync(shapeFile, shape.stdout);
    const push = prisma(["db", "execute", "--file", shapeFile, "--url", namespace.url], namespace.url);
    if (push.status !== 0) {
      throw new Error(`could not apply the out-of-band schema shape:\n${(push.stdout + push.stderr).trim()}`);
    }

    // 3. Record 0012 as applied without executing it (steps = 0), like the real
    //    databases.
    copyMigration(LEGACY_RESOLVED, path.join(legacy.workspace, "migrations"));
    const resolve = prisma(
      ["migrate", "resolve", "--applied", LEGACY_RESOLVED, "--schema", legacy.schemaFile],
      namespace.url
    );
    if (resolve.status !== 0) {
      throw new Error(
        `could not record the fixture's applied-but-not-executed migration:\n${(
          resolve.stdout + resolve.stderr
        ).trim()}`
      );
    }
  } finally {
    fs.rmSync(legacy.workspace, { recursive: true, force: true });
    fs.rmSync(model.workspace, { recursive: true, force: true });
  }
  return { migrations: [...LEGACY_EXECUTED, LEGACY_RESOLVED].sort() };
}

async function readHistory(url, schema) {
  const client = new PrismaClient({ datasources: { db: { url } } });
  try {
    return await client.$queryRawUnsafe(
      `SELECT migration_name, checksum, applied_steps_count, finished_at, rolled_back_at
         FROM "${schema}"."_prisma_migrations"
         ORDER BY started_at, migration_name`
    );
  } finally {
    await client.$disconnect();
  }
}

/** One hash per table over the full row content, to prove nothing changed. */
async function contentHashes(url, schema) {
  const client = new PrismaClient({ datasources: { db: { url } } });
  try {
    const tables = await client.$queryRawUnsafe(
      `SELECT table_name
         FROM information_schema.tables
        WHERE table_schema = $1 AND table_type = 'BASE TABLE'
        ORDER BY table_name`,
      schema
    );
    const hashes = {};
    for (const { table_name: table } of tables) {
      if (table === "_prisma_migrations") continue;
      const rows = await client.$queryRawUnsafe(
        `SELECT count(*)::int AS rows,
                md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), '')) AS hash
           FROM "${schema}"."${table}" x`
      );
      hashes[table] = { rows: rows[0].rows, hash: rows[0].hash };
    }
    return hashes;
  } finally {
    await client.$disconnect();
  }
}

async function seedRepresentativeData(url) {
  const client = new PrismaClient({ datasources: { db: { url } } });
  try {
    const organization = await client.organization.create({
      data: { name: "Legacy Org", slug: "legacy-org" },
    });
    const user = await client.user.create({
      data: {
        email: "legacy@example.test",
        passwordHash: "not-a-real-hash",
        fullName: "Legacy User",
      },
    });
    await client.organizationMember.create({
      data: { organizationId: organization.id, userId: user.id, role: "OWNER" },
    });
    await client.accountOrganization.create({
      data: { accountId: user.id, organizationId: organization.id, role: "ADMINISTRATOR" },
    });
    const workspace = await client.workspace.create({
      data: { name: "Legacy Workspace", slug: "legacy-workspace" },
    });
    const project = await client.project.create({
      data: {
        workspaceId: workspace.id,
        organizationId: organization.id,
        name: "Legacy Project",
      },
    });
    const environment = await client.environment.create({
      data: { projectId: project.id, name: "Production", slug: "production", type: "PRODUCTION" },
    });
    const service = await client.service.create({
      data: {
        projectId: project.id,
        environmentId: environment.id,
        name: "legacy-service",
        hostname: "legacy-service",
        type: "WEB",
        env: { NODE_ENV: "production" },
      },
    });
    const website = await client.website.create({
      data: {
        workspaceId: workspace.id,
        organizationId: organization.id,
        projectId: project.id,
        name: "Legacy Website",
        subdomain: "legacy",
      },
    });
    await client.deployment.create({
      data: {
        websiteId: website.id,
        version: 1,
        storagePath: "local://legacy",
        uploadedById: user.id,
      },
    });
    const serviceDeployment = await client.serviceDeployment.create({
      data: { serviceId: service.id, version: 1, status: "READY" },
    });
    await client.serviceDeploymentLog.create({
      data: { deploymentId: serviceDeployment.id, level: "info", message: "legacy build log" },
    });
    await client.containerInstance.create({
      data: {
        deploymentId: serviceDeployment.id,
        serviceId: service.id,
        containerId: "legacy-container",
      },
    });
    await client.auditLog.create({
      data: {
        action: "WORKSPACE_CREATED",
        resourceType: "workspace",
        workspaceId: workspace.id,
        actorId: user.id,
        metadata: { source: "fixture" },
      },
    });
    await client.outboxEvent.create({
      data: { workspaceId: workspace.id, eventType: "WorkspaceCreated", payload: { ok: true } },
    });
    await client.notification.create({
      data: { recipient: user.email, type: "welcome", payload: { ok: true } },
    });
  } finally {
    await client.$disconnect();
  }
}

async function main() {
  const adminUrl = process.env[ADMIN_URL_ENV]?.trim();
  requireAdminUrl(adminUrl);
  if (process.env.NODE_ENV === "production") refuse("refusing to run destructive verification with NODE_ENV=production.");

  const adminTarget = parseTarget(adminUrl, ADMIN_URL_ENV);
  assertSafeIdentifier(adminTarget.database, ADMIN_URL_ENV);
  if (adminTarget.schema !== "public") {
    refuse(`${ADMIN_URL_ENV} must not select an application schema; omit the schema parameter.`);
  }
  const live = await probe(adminUrl);
  if (!live || live.database !== adminTarget.database) {
    refuse(
      `the admin connection reported database "${live?.database}", not the configured "${adminTarget.database}".`
    );
  }

  const canCreateDatabase = await adminQuery(adminUrl, adminTarget, {
    text: "SELECT rolcreatedb OR rolsuper AS allowed FROM pg_roles WHERE rolname = current_user",
  });
  const kind = canCreateDatabase[0]?.allowed ? "database" : "schema";
  const namespace = await createNamespace(adminUrl, adminTarget, kind);
  const expectedSchema = kind === "database" ? "public" : namespace.name;
  const observed = await createNamespace(adminUrl, adminTarget, kind);
  const observedSchema = kind === "database" ? "public" : observed.name;
  const failures = [];

  log(`created ${namespace.kind} "${namespace.name}" (fixture) and "${observed.name}" (observed model)`);

  try {
    assertMigrationTarget(namespace, parseTarget(namespace.url, "fixture target"));
    assertMigrationTarget(observed, parseTarget(observed.url, "observed model target"));

    log("building the observed existing-installation state (0001–0013, 0012 recorded with 0 steps)…");
    await buildLegacyFixture(namespace, observed);

    const historyBefore = await readHistory(namespace.url, expectedSchema);
    if (historyBefore.length !== 12) {
      failures.push(`fixture history has ${historyBefore.length} records, expected 12`);
    }
    const resolved = historyBefore.find((row) => row.migration_name === LEGACY_RESOLVED);
    if (!resolved || resolved.applied_steps_count !== 0) {
      failures.push(`${LEGACY_RESOLVED} is not recorded with applied_steps_count = 0 as expected`);
    }
    for (const record of historyBefore) {
      const file = path.join(migrationsDir, record.migration_name, "migration.sql");
      if (!fs.existsSync(file)) {
        failures.push(`fixture history references "${record.migration_name}", which is not in the repository`);
        continue;
      }
      if (sha256File(file) !== record.checksum) {
        failures.push(`checksum mismatch for applied migration "${record.migration_name}"`);
      }
    }

    await seedRepresentativeData(namespace.url);
    const schemaBefore = await readSchema(namespace.url, expectedSchema);
    const rowsBefore = await contentHashes(namespace.url, expectedSchema);
    const populatedTables = Object.values(rowsBefore).filter((entry) => entry.rows > 0).length;
    log(`fixture seeded: ${Object.values(rowsBefore).reduce((total, entry) => total + entry.rows, 0)} rows in ${populatedTables} tables`);

    // The premise of the test: this fixture is an installation whose schema
    // already matches the model it was shaped from, exactly like `public` and
    // `sitedock_test` were.
    const observedModel = await readSchema(observed.url, observedSchema);
    if (fingerprint(schemaBefore) !== fingerprint(observedModel)) {
      failures.push("the fixture does not match the observed (0014) model before reconciliation");
    }

    // Phase 1: the repair migrations alone must be pure no-ops on it.
    log("running the repair migrations (through 0014) against the fixture…");
    const repair = migrationWorkspace("sitedock-repair-", OBSERVED_MODEL_MIGRATIONS);
    let repairDeploy;
    try {
      repairDeploy = prisma(["migrate", "deploy", "--schema", repair.schemaFile], namespace.url);
    } finally {
      fs.rmSync(repair.workspace, { recursive: true, force: true });
    }
    log(`prisma migrate deploy (through 0014) exited ${repairDeploy.status}`);
    if (repairDeploy.status !== 0) {
      failures.push(`repair migrate deploy failed:\n${(repairDeploy.stdout + repairDeploy.stderr).trim()}`);
    }
    for (const name of REPAIR_MIGRATIONS) {
      if (!(repairDeploy.stdout + repairDeploy.stderr).includes(name)) {
        failures.push(`migrate deploy did not apply "${name}" to the existing installation`);
      }
    }
    const schemaAfterRepair = await readSchema(namespace.url, expectedSchema);
    if (fingerprint(schemaBefore) !== fingerprint(schemaAfterRepair)) {
      failures.push("the repair migrations changed the schema of an installation that already matched the model");
    }

    // Phase 2: the rest of the tracked chain upgrades it to today's model.
    log("running the remaining tracked migrations against the fixture…");
    const deploy = prisma(["migrate", "deploy", "--schema", schemaPath], namespace.url);
    log(`prisma migrate deploy exited ${deploy.status}`);
    if (deploy.status !== 0) {
      failures.push(`migrate deploy failed:\n${(deploy.stdout + deploy.stderr).trim()}`);
    }

    const rowsAfter = await contentHashes(namespace.url, expectedSchema);
    for (const [table, before] of Object.entries(rowsBefore)) {
      const after = rowsAfter[table];
      if (!after) {
        failures.push(`table "${table}" disappeared during reconciliation`);
      } else if (after.rows !== before.rows || after.hash !== before.hash) {
        failures.push(
          `table "${table}" changed: ${before.rows} rows/${before.hash} -> ${after.rows} rows/${after.hash}`
        );
      }
    }

    const historyAfter = await readHistory(namespace.url, expectedSchema);
    const directories = fs
      .readdirSync(migrationsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    if (historyAfter.length !== directories.length) {
      failures.push(`history has ${historyAfter.length} records for ${directories.length} migration directories`);
    }
    for (const directory of directories) {
      const record = historyAfter.find((row) => row.migration_name === directory);
      if (!record) {
        failures.push(`migration "${directory}" was not recorded`);
      } else if (!REPAIR_MIGRATIONS.includes(directory) && record.applied_steps_count < 1) {
        // 0012 keeps its historical zero-step record: reconciliation must not
        // rewrite what an existing database already recorded.
        if (directory !== LEGACY_RESOLVED) {
          failures.push(`pre-existing record for "${directory}" changed to ${record.applied_steps_count} steps`);
        }
      }
    }
    const resolvedAfter = historyAfter.find((row) => row.migration_name === LEGACY_RESOLVED);
    if (!resolvedAfter || resolvedAfter.applied_steps_count !== 0) {
      failures.push(`${LEGACY_RESOLVED} no longer carries its original zero-step record`);
    }
    for (const name of REPAIR_MIGRATIONS) {
      const record = historyAfter.find((row) => row.migration_name === name);
      if (!record || record.applied_steps_count < 1) {
        failures.push(`repair migration "${name}" is not recorded as executed`);
      }
    }

    const postDiff = prisma(
      ["migrate", "diff", "--from-url", namespace.url, "--to-schema-datamodel", schemaPath, "--exit-code"],
      namespace.url
    );
    if (postDiff.status !== 0) {
      failures.push(
        `the reconciled installation drifts from schema.prisma:\n${(postDiff.stdout + postDiff.stderr).trim()}`
      );
    }

    const status = prisma(["migrate", "status", "--schema", schemaPath], namespace.url);
    if (status.status !== 0 || !/up to date/i.test(status.stdout + status.stderr)) {
      failures.push(`migrate status is not clean after reconciliation:\n${(status.stdout + status.stderr).trim()}`);
    }

    const again = prisma(["migrate", "deploy", "--schema", schemaPath], namespace.url);
    if (again.status !== 0 || !/no pending migrations/i.test(again.stdout + again.stderr)) {
      failures.push(`repeating the reconciliation was not a no-op:\n${(again.stdout + again.stderr).trim()}`);
    }
  } finally {
    if (keep) {
      log(`kept ${namespace.kind}s "${namespace.name}" and "${observed.name}" (--keep)`);
    } else {
      await dropNamespace(adminUrl, adminTarget, namespace);
      await dropNamespace(adminUrl, adminTarget, observed);
      log(`dropped ${namespace.kind}s "${namespace.name}" and "${observed.name}"`);
    }
  }

  if (failures.length > 0) {
    for (const failure of failures) console.error(`[verify-reconciliation] FAIL ${failure}`);
    process.exitCode = 1;
    return;
  }
  log("PASS existing installation reconciled: repair migrations were no-ops, the chain upgraded it to schema.prisma, no data changed");
}

main().catch((error) => {
  if (error instanceof SafetyRefusal) {
    console.error(`[verify-reconciliation] REFUSED ${error.message}`);
  } else {
    console.error(`[verify-reconciliation] ERROR ${error.message}`);
  }
  process.exitCode = 1;
});
