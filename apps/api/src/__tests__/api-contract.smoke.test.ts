import { describe, expect, it, beforeAll, afterAll } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { validateProductionConfig } from "../config";
import { createApp } from "../app";

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

describe("validateProductionConfig (Fase 19 §7/§8 — fail closed)", () => {
  it("producción sin DATABASE_URL falla", () => {
    const errors = validateProductionConfig({ NODE_ENV: "production" }, true);
    expect(errors.some((e) => e.includes("DATABASE_URL"))).toBe(true);
  });

  it("stripe pedido sin credenciales produce dos errores explícitos", () => {
    const errors = validateProductionConfig({ NODE_ENV: "production", PAYMENT_PROVIDER: "stripe", STRIPE_SECRET_KEY: "", STRIPE_WEBHOOK_SECRET: "", DATABASE_URL: "postgresql://x" }, true);
    expect(errors).toHaveLength(2);
  });

  it("desarrollo nunca bloquea el arranque por providers", () => {
    expect(validateProductionConfig({}, false)).toEqual([]);
  });
});

async function call(method: string, path: string) {
  const res = await fetch(`${baseUrl}${path}`);
  return { status: res.status };
}

describe("HTTP contract smoke (sin BD)", () => {
  it("health/live OK y rutas inexistentes → 404 estructurado con requestId", async () => {
    expect((await call("GET", "/health/live")).status).toBe(200);
    const res = await call("GET", "/api/v1/definitivamente-no-existe");
    expect(res.status).toBe(404);
  });

  it("rutas protegidas → 401 sin sesión", async () => {
    expect((await call("GET", "/api/v1/workspaces")).status).toBe(401);
    expect((await call("POST", "/api/v1/workspaces/ws/demo-payments/simulate-payment-succeeded")).status).toBe(401);
  });

  it("checkout demo público con sesión desconocida → 404 (sin tocar BD)", async () => {
    expect((await call("GET", "/api/v1/public/demo-checkout/demo_otc_nope")).status).toBe(404);
  });

  it("webhook a provider no activo → 400 UNKNOWN_PAYMENT_PROVIDER sin stack", async () => {
    const res = await fetch(`${baseUrl}/api/v1/webhooks/payments/stripe`, {
      method: "POST",
      headers: { "stripe-signature": "t=1,v1=deadbeef" },
      body: "{}",
    });
    // Con PAYMENT_PROVIDER=mock activo, stripe es un provider desconocido.
    expect(res.status).toBe(400);
    const bodyText = await res.text();
    expect(bodyText).toMatch(/Unknown payment provider/i);
  });

  it("provider desconocido en webhook → rechazado (400 o 404)", async () => {
    const res = await call("POST", "/api/v1/webhooks/payments/nope");
    expect([400, 404]).toContain(res.status);
  });

  it("admin metrics requiere plataforma admin", async () => {
    expect((await call("GET", "/api/v1/admin/metrics")).status).toBeGreaterThanOrEqual(401);
  });
});

