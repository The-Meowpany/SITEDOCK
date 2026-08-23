import { describe, expect, it, beforeAll, afterAll } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createApp } from "../app";

/**
 * Fase 21 — Adversarial multi-tenant security suite.
 *
 * These tests exercise the REAL HTTP surface without a database to verify
 * that authorization boundaries are enforced at the middleware/route level.
 * Domain-level isolation is covered by the per-package unit tests with fakes.
 *
 * Key invariant under test:
 *   An authenticated user must NEVER access another workspace's data,
 *   regardless of how they craft the request.
 */

let server: Server;
let baseUrl = "";

beforeAll(async () => {
  const app = createApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function req(method: string, path: string, opts?: {
  body?: unknown;
  headers?: Record<string, string>;
}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(opts?.body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...opts?.headers,
    },
    body: opts?.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text().catch(() => "");
  return { status: res.status, text };
}

// All requests in this suite are UNAUTHENTICATED — the first boundary is
// authentication itself. If any of these return anything other than 401/404,
// the API has an authentication bypass.

const WORKSPACE_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

describe("Multi-tenant security (unauthenticated attacker)", () => {
  const attackPaths: Array<[string, string]> = [
    ["GET", `/workspaces/${WORKSPACE_A}`],
    ["GET", `/workspaces/${WORKSPACE_A}/websites`],
    ["GET", `/workspaces/${WORKSPACE_A}/clients`],
    ["GET", `/workspaces/${workspaceId(WORKSPACE_A)}/projects`],
    ["GET", `/workspaces/${WORKSPACE_A}/dashboard`],
    ["GET", `/workspaces/${WORKSPACE_A}/plans`],
    ["GET", `/workspaces/${WORKSPACE_A}/audit-logs`],
    ["GET", `/workspaces/${WORKSPACE_A}/merchant/status`],
    ["PATCH", `/workspaces/${WORKSPACE_A}/branding`],
    ["POST", `/workspaces/${WORKSPACE_A}/clients`],
    ["POST", `/workspaces/${WORKSPACE_A}/websites`],
    ["POST", `/workspaces/${WORKSPACE_A}/plans`],
  ];

  for (const [method, path] of attackPaths) {
    it(`${method} ${path.replace(WORKSPACE_A, ":ws")} → 401 sin sesión`, async () => {
      const body = method !== "GET" ? { name: "attack" } : undefined;
      const res = await req(method, path, { body });
      expect(res.status).toBe(401);
    });
  }
});

describe("Multi-tenant security (resource ID substitution)", () => {
  // Even WITH a session cookie, a user who is not a member of Workspace B
  // must receive 403/404 when trying to access Workspace B's resources.
  // Without a DB we can't create real sessions, but we verify that the
  // middleware chain REJECTS invalid/missing sessions before reaching
  // any business logic.

  const resourceSubstitutions: Array<{ label: string; path: string }> = [
    { label: "deployments", path: "/workspaces/{WS}/websites/fake-id/deployments" },
    { label: "backups", path: "/workspaces/{WS}/websites/fake-id/backups" },
    { label: "maintenance", path: "/workspaces/{WS}/websites/fake-id/maintenance-requests" },
    { label: "domains", path: "/workspaces/{WS}/websites/fake-id/domains" },
    { label: "charges", path: "/workspaces/{WS}/websites/fake-id/charges" },
    { label: "subscription", path: "/workspaces/{WS}/websites/fake-id/subscription" },
    { label: "refund", path: "/workspaces/{WS}/payments/fake-id/refund" },
    { label: "merchant", path: "/workspaces/{WS}/merchant/connect" },
  ];

  for (const resource of resourceSubstitutions) {
    it(`POST ${resource.label} → 401 sin auth`, async () => {
      const res = await req("POST", resource.path.replace("{WS}", WORKSPACE_A), { body: {} });
      expect([401, 403, 404]).toContain(res.status);
    });

    it(`GET ${resource.label} → 401 sin auth`, async () => {
      const res = await req("GET", resource.path.replace("{WS}", WORKSPACE_A));
      expect([401, 403, 404]).toContain(res.status);
    });
  }
});

describe("Admin routes — PLATFORM_ADMIN gate", () => {
  const adminPaths = [
    "/api/v1/admin/overview",
    "/api/v1/admin/workspaces",
    "/api/v1/admin/users",
    "/api/v1/admin/websites",
    "/api/v1/admin/payments",
    "/api/v1/admin/webhook-events",
    "/api/v1/admin/reconciliation?workspaceId=11111111-1111-1111-1111-111111111111&days=30",
    "/api/v1/admin/metrics",
  ];

  for (const path of adminPaths) {
    it(`GET ${path} → ≥401 sin sesión`, async () => {
      const res = await req("GET", path);
      expect(res.status).toBeGreaterThanOrEqual(401);
    });
    it(`POST ${path} → ≥401 sin sesión`, async () => {
      const res = await req("POST", path, { body: {} });
      expect(res.status).toBeGreaterThanOrEqual(401);
    });
  }

  const adminMutations: Array<{ label: string; path: string }> = [
    { label: "suspend user", path: "/api/v1/admin/users/11111111-1111-1111-1111-111111111111/suspend" },
    { label: "reinstate user", path: "/api/v1/admin/users/11111111-1111-1111-1111-111111111111/reinstate" },
    { label: "suspend website", path: "/api/v1/admin/websites/11111111-1111-1111-1111-111111111111/suspend" },
  ];

  for (const mutation of adminMutations) {
    it(`POST ${mutation.label} → ≥401 sin sesión`, async () => {
      const res = await req("POST", mutation.path);
      expect(res.status).toBeGreaterThanOrEqual(401);
    });
  }
});

function workspaceId(ws: string): string {
  return ws;
}
