import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  assertDedicatedTestDatabase,
  useDedicatedTestDatabase,
  TEST_DATABASE_URL_ENV,
} from "@sitedock/database";
import { deleteOwnFixtures, type FixtureCleanupClient } from "./support/test-fixtures";

/**
 * Regression tests for the 2026-10-24 data-loss incident.
 *
 * These are pure unit tests: no PostgreSQL connection is opened. They pin the
 * two invariants whose failure destroyed development data:
 *
 *   1. cleanup after a failed setup must never become an unscoped delete
 *      (Prisma treats `undefined` in a filter as "no filter at all");
 *   2. an integration run must refuse to target the application schema, even
 *      when the database name happens to contain "test".
 */

const ENV_KEYS = [TEST_DATABASE_URL_ENV, "DATABASE_URL", "NODE_ENV"] as const;

function snapshotEnv(): Record<string, string | undefined> {
  return Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
}

function restoreEnv(snapshot: Record<string, string | undefined>): void {
  for (const key of ENV_KEYS) {
    if (snapshot[key] === undefined) delete process.env[key];
    else process.env[key] = snapshot[key];
  }
}

/** Tallies every deleteMany call so we can prove what cleanup would run. */
function recordingClient(): FixtureCleanupClient & { calls: Array<{ model: string; where: unknown }> } {
  const calls: Array<{ model: string; where: unknown }> = [];
  const model = (name: string) => ({
    deleteMany: async (args: { where: unknown }) => {
      calls.push({ model: name, where: args.where });
      return { count: 0 };
    },
  });
  return {
    calls,
    serviceDeploymentLog: model("serviceDeploymentLog"),
    containerInstance: model("containerInstance"),
    serviceDeployment: model("serviceDeployment"),
    service: model("service"),
    project: model("project"),
    workspace: model("workspace"),
  };
}

function fakeConnectionClient(identity: { database: string; schema: string }, relation: string | null) {
  return {
    $queryRawUnsafe: vi.fn(async (sql: string) =>
      sql.includes("to_regclass") ? [{ relation }] : [identity]
    ),
  } as unknown as Parameters<typeof assertDedicatedTestDatabase>[0];
}

const TEST_URL = "postgresql://sitedock:sitedock@localhost:5432/sitedock?schema=sitedock_test";

let envSnapshot: Record<string, string | undefined>;

beforeEach(() => {
  envSnapshot = snapshotEnv();
});

afterEach(() => {
  restoreEnv(envSnapshot);
});

describe("fixture cleanup after failed setup", () => {
  it("is a no-op when no fixture ids were assigned", async () => {
    const client = recordingClient();

    await deleteOwnFixtures(
      { workspaceIds: [undefined], projectIds: [undefined], serviceIds: [undefined] },
      client
    );

    expect(client.calls).toEqual([]);
  });

  it("is a no-op when the fixture scopes are empty", async () => {
    const client = recordingClient();

    await deleteOwnFixtures({ workspaceIds: [], projectIds: [], serviceIds: [] }, client);

    expect(client.calls).toEqual([]);
  });

  it("never issues an unscoped delete when only some ids were assigned", async () => {
    const client = recordingClient();

    await deleteOwnFixtures(
      { workspaceIds: ["ws-1", undefined], projectIds: [undefined], serviceIds: ["svc-1"] },
      client
    );

    // Every delete is filtered by an explicit id set pulled from the fixture.
    for (const call of client.calls) {
      const where = JSON.stringify(call.where);
      expect(where).toContain('"in"');
      expect(where).not.toContain("undefined");
      expect(where).not.toBe("{}");
    }
    expect(client.calls.map((c) => c.model).sort()).toEqual([
      "containerInstance",
      "service",
      "serviceDeployment",
      "serviceDeploymentLog",
      "workspace",
    ]);
    expect(client.calls.find((c) => c.model === "workspace")?.where).toEqual({
      id: { in: ["ws-1"] },
    });
  });
});

describe("dedicated test database guard", () => {
  it("refuses to run when no test database is configured", async () => {
    delete process.env[TEST_DATABASE_URL_ENV];
    delete process.env.DATABASE_URL;

    await expect(
      assertDedicatedTestDatabase(fakeConnectionClient({ database: "sitedock", schema: "sitedock_test" }, "x"), "suite")
    ).rejects.toThrow(new RegExp(`${TEST_DATABASE_URL_ENV} is not set`));
  });

  it("refuses to run when the process is pointed somewhere else", async () => {
    process.env[TEST_DATABASE_URL_ENV] = TEST_URL;
    process.env.DATABASE_URL = "postgresql://sitedock:sitedock@localhost:5432/sitedock?schema=public";

    await expect(
      assertDedicatedTestDatabase(fakeConnectionClient({ database: "sitedock", schema: "sitedock_test" }, "x"), "suite")
    ).rejects.toThrow(/DATABASE_URL is not the configured test database/);
  });

  it("rejects the public schema during setup and leaves DATABASE_URL untouched", () => {
    process.env[TEST_DATABASE_URL_ENV] =
      "postgresql://sitedock:sitedock@localhost:5432/sitedock?schema=public";
    delete process.env.DATABASE_URL;

    expect(() => useDedicatedTestDatabase()).toThrow(/dedicated schema, not `public`/);
    expect(process.env.DATABASE_URL).toBeUndefined();
  });

  it("rejects a development database whose name contains 'test'", async () => {
    const url = "postgresql://sitedock:sitedock@localhost:5432/sitedock_test?schema=public";
    process.env[TEST_DATABASE_URL_ENV] = url;
    process.env.DATABASE_URL = url;

    await expect(
      assertDedicatedTestDatabase(fakeConnectionClient({ database: "sitedock_test", schema: "public" }, "x"), "suite")
    ).rejects.toThrow(/public/);
  });

  it("rejects a production run", () => {
    process.env[TEST_DATABASE_URL_ENV] = TEST_URL;
    process.env.DATABASE_URL = TEST_URL;
    process.env.NODE_ENV = "production";

    expect(() => useDedicatedTestDatabase()).toThrow(/NODE_ENV=production/);
  });

  it("rejects a live connection that landed in another schema", async () => {
    process.env[TEST_DATABASE_URL_ENV] = TEST_URL;
    process.env.DATABASE_URL = TEST_URL;

    await expect(
      assertDedicatedTestDatabase(fakeConnectionClient({ database: "sitedock", schema: "public" }, "x"), "suite")
    ).rejects.toThrow(/live connection is database/);
  });

  it("rejects an unprovisioned test namespace", async () => {
    process.env[TEST_DATABASE_URL_ENV] = TEST_URL;
    process.env.DATABASE_URL = TEST_URL;

    await expect(
      assertDedicatedTestDatabase(fakeConnectionClient({ database: "sitedock", schema: "sitedock_test" }, null), "suite")
    ).rejects.toThrow(/not provisioned/);
  });

  it("accepts a verified dedicated namespace", async () => {
    process.env[TEST_DATABASE_URL_ENV] = TEST_URL;
    process.env.DATABASE_URL = TEST_URL;
    process.env.NODE_ENV = "test";

    await expect(
      assertDedicatedTestDatabase(
        fakeConnectionClient({ database: "sitedock", schema: "sitedock_test" }, "sitedock_test.service_deployments"),
        "suite"
      )
    ).resolves.toBeUndefined();
  });
});
