import { describe, expect, it, beforeAll, afterAll } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createApp } from "../app";

/**
 * Public static website serving integration tests.
 *
 * These tests exercise the /sites/:subdomain/:path(*) route mounted
 * outside /api/v1. They use the real createApp() with an ephemeral port.
 *
 * Path-safety tests (traversal, null bytes) do not require a database —
 * they are rejected by input validation before any DB call. The
 * "unknown subdomain" test requires a real database; without one it
 * observes 503 (database unavailable) instead of 404.
 */

let server: Server;
let baseUrl = "";
let databaseAvailable = false;

beforeAll(async () => {
  // Ensure DATABASE_URL is set for the PrismaClient used by createApp().
  // The vitest `env` config may not propagate to already-imported modules.
  process.env.DATABASE_URL =
    process.env.DATABASE_URL ?? "postgresql://smoke:smoke@127.0.0.1:5432/smoke";

  const app = createApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  // Probe database availability once.
  const health = await fetch(`${baseUrl}/health/ready`);
  databaseAvailable = health.status === 200;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("Public static website serving", () => {
  it("GET /health/live still returns 200 (public route does not break health)", async () => {
    const res = await fetch(`${baseUrl}/health/live`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
  });

  it("public sites route returns 404 for path traversal in subdomain", async () => {
    const res = await fetch(`${baseUrl}/sites/../etc/passwd/`);
    expect(res.status).toBe(404);
  });

  it("public sites route returns 404 for null byte injection", async () => {
    const res = await fetch(`${baseUrl}/sites/test%00subdomain/`);
    expect(res.status).toBe(404);
  });

  it("public sites route returns 404 for unknown subdomain (or 503 if DB unavailable)", async () => {
    const res = await fetch(`${baseUrl}/sites/nonexistent-subdomain/`);
    if (databaseAvailable) {
      expect(res.status).toBe(404);
    } else {
      expect([500, 503]).toContain(res.status);
    }
  });

  it("public sites route returns 404 for encoded path traversal", async () => {
    const res = await fetch(`${baseUrl}/sites/valid-subdomain/%2e%2e/%2e%2e/etc/passwd`);
    expect(res.status).toBe(404);
  });
});
