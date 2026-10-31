/**
 * Fixture isolation helpers for the PostgreSQL integration suites.
 *
 * The deployment queue (`claimNext`) is intentionally global: it claims the
 * oldest eligible deployment regardless of which test created it. The suites in
 * this package therefore run sequentially (see vitest.config.ts) inside a
 * dedicated test schema, and each suite removes only the rows it can identify
 * as its own fixtures.
 *
 * `purgeStaleFixtureWorkspaces` recovers from an interrupted run: a crashed
 * suite can leave QUEUED rows behind that a later suite's `claimNext` would
 * legitimately pick up. It only ever matches workspace slugs created by these
 * integration suites, inside the guarded test schema, so development and
 * production data (which live in a different schema) are never in scope.
 */

import { prisma } from "@sitedock/database";

/** Workspace slugs owned exclusively by the integration suites in this package. */
export const FIXTURE_WORKSPACE_SLUG_PREFIXES = ["mapping-test-ws-", "concurrency-test-ws-"];

/** Fixtures younger than this are assumed to belong to a live test run. */
export const STALE_FIXTURE_MIN_AGE_MS = 10 * 60 * 1000;

type OwnedFixtures = {
  workspaceIds?: Array<string | undefined>;
  projectIds?: Array<string | undefined>;
  serviceIds?: Array<string | undefined>;
};

type IdFilter = { in: string[] };

/**
 * The slice of PrismaClient that fixture cleanup needs. Narrow on purpose so
 * the fail-closed behaviour can be unit tested without touching a database.
 */
export type FixtureCleanupClient = {
  serviceDeploymentLog: { deleteMany(args: { where: { deployment: { serviceId: IdFilter } } }): Promise<unknown> };
  containerInstance: { deleteMany(args: { where: { serviceId: IdFilter } }): Promise<unknown> };
  serviceDeployment: { deleteMany(args: { where: { serviceId: IdFilter } }): Promise<unknown> };
  service: { deleteMany(args: { where: { id: IdFilter } }): Promise<unknown> };
  project: { deleteMany(args: { where: { id: IdFilter } }): Promise<unknown> };
  workspace: { deleteMany(args: { where: { id: IdFilter } }): Promise<unknown> };
};

/**
 * Returns only well-formed ids. A scope that was declared but produced no valid
 * id is dropped entirely: cleanup must never fall back to an unscoped delete
 * (Prisma omits `undefined` filters, which would match every row).
 */
function validIds(label: string, ids: Array<string | undefined> | undefined): string[] {
  if (!ids) return [];
  const valid = ids.filter((id): id is string => typeof id === "string" && id.length > 0);
  if (valid.length !== ids.length) {
    console.warn(
      `[test-fixtures] skipping ${label} cleanup: ${ids.length - valid.length} fixture id(s) were never assigned ` +
        `(setup did not complete). Refusing to run a cleanup that could match unrelated rows.`
    );
  }
  return valid;
}

/**
 * Deletes only the fixtures a suite actually created.
 *
 * Prisma treats `undefined` in a `where` clause as "no filter", so a suite that
 * fails in `beforeAll` must never reach the delete calls with unset ids: that
 * would turn `where: { id: undefined }` into an unscoped delete. Any missing id
 * is filtered out here and an empty set short-circuits to a no-op.
 */
export async function deleteOwnFixtures(
  fixtures: OwnedFixtures,
  client: FixtureCleanupClient = prisma
): Promise<void> {
  const serviceIds = validIds("service", fixtures.serviceIds);
  const projectIds = validIds("project", fixtures.projectIds);
  const workspaceIds = validIds("workspace", fixtures.workspaceIds);

  if (serviceIds.length === 0 && projectIds.length === 0 && workspaceIds.length === 0) {
    return;
  }

  if (serviceIds.length > 0) {
    const byService = { serviceId: { in: serviceIds } };
    await client.serviceDeploymentLog.deleteMany({ where: { deployment: byService } });
    await client.containerInstance.deleteMany({ where: byService });
    await client.serviceDeployment.deleteMany({ where: byService });
    await client.service.deleteMany({ where: { id: { in: serviceIds } } });
  }

  if (projectIds.length > 0) {
    await client.project.deleteMany({ where: { id: { in: projectIds } } });
  }

  if (workspaceIds.length > 0) {
    await client.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
  }
}

/**
 * Deletes fixture workspaces (and their projects, services, deployments,
 * instances and logs) left behind by a previous, interrupted test run.
 *
 * Returns the number of stale workspaces removed.
 */
export async function purgeStaleFixtureWorkspaces(
  minAgeMs: number = STALE_FIXTURE_MIN_AGE_MS
): Promise<number> {
  // Only workspaces older than `minAgeMs` are considered stale. A fixture
  // created moments ago belongs to a suite that is running right now (possibly
  // in another worker) and must never be deleted from under it.
  const cutoff = new Date(Date.now() - minAgeMs);
  const stale = await prisma.workspace.findMany({
    where: {
      createdAt: { lt: cutoff },
      OR: FIXTURE_WORKSPACE_SLUG_PREFIXES.map((prefix) => ({ slug: { startsWith: prefix } })),
    },
    select: { id: true },
  });

  if (stale.length === 0) return 0;

  const workspaceIds = stale.map((workspace) => workspace.id);

  const services = await prisma.service.findMany({
    where: { project: { workspaceId: { in: workspaceIds } } },
    select: { id: true },
  });
  const serviceIds = services.map((service) => service.id);

  if (serviceIds.length > 0) {
    // Children first, so cleanup never depends on cascade rules.
    await prisma.serviceDeploymentLog.deleteMany({
      where: { deployment: { serviceId: { in: serviceIds } } },
    });
    await prisma.containerInstance.deleteMany({ where: { serviceId: { in: serviceIds } } });
    await prisma.serviceDeployment.deleteMany({ where: { serviceId: { in: serviceIds } } });
    await prisma.service.deleteMany({ where: { id: { in: serviceIds } } });
  }

  await prisma.project.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
  await prisma.workspace.deleteMany({ where: { id: { in: workspaceIds } } });

  return workspaceIds.length;
}
