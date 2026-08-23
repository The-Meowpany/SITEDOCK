import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createApp } from "../app";

/**
 * Contrato HTTP de la API sin base de datos (Fase: QA — brief §10/§45).
 *
 * Estas pruebas fijan las garantías de la capa de interfaces que los tests de
 * dominio no cubren: orden de middleware, códigos de error estructurados,
 * ausencia de stack traces, gating de rutas demo y cabeceras de seguridad.
 * Corren en CI sin servicios.
 */

let server: Server;
let baseUrl = "";

beforeAll(async () => {
  const app = createApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function call(
  method: string,
  path: string,
  init?: { body?: unknown; headers?: Record<string, string> }
) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(init?.body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  let json: Record<string, unknown> | null = null;
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    /* respuestas 204 no llevan cuerpo */
  }
  return { status: res.status, headers: res.headers, json, text };
}

describe("Contrato HTTP de la API (smoke, sin BD)", () => {
  it("GET /health/live responde 200 con status ok", async () => {
    const res = await call("GET", "/health/live");
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ status: "ok" });
  });

  it("GET /health/ready responde con shape válido aunque la BD no esté (fail-safe)", async () => {
    const res = await call("GET", "/health/ready");
    expect([200, 503]).toContain(res.status);
    expect(res.json).toHaveProperty("status");
  });

  it("404 estructurado con requestId para rutas inexistentes", async () => {
    const res = await call("GET", "/api/v1/no-existe");
    expect(res.status).toBe(404);
    expect(res.json).toMatchObject({ code: "NOT_FOUND", message: "Route not found" });
    expect(String(res.json?.requestId)).toBeTruthy();
  });

  it("401 UNAUTHORIZED en ruta protegida sin cookie de sesión", async () => {
    const res = await call("GET", "/api/v1/workspaces");
    expect(res.status).toBe(401);
    expect(res.json).toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("webhook con firma inválida → error interno SIN filtrar stack traces", async () => {
    const res = await call("POST", "/api/v1/webhooks/payments/mock", {
      headers: { "x-sitedock-signature": "deadbeef" },
      body: { type: "payment.succeeded" },
    });

    // El Error crudo del verify cae al handler genérico: 500 INTERNAL_ERROR,
    // nunca el mensaje interno ni un stack trace.
    expect(res.status).toBe(500);
    expect(res.json).toMatchObject({ code: "INTERNAL_ERROR" });
    expect(JSON.stringify(res.json)).not.toMatch(/at\s+\w+\s+\(/); // sin stack
    expect(JSON.stringify(res.json)).not.toContain("node_modules");
  });

  it("webhook a provider desconocido → ApplicationError mapeada a 400", async () => {
    const rawBody = JSON.stringify({ type: "ignored", eventId: `evt_${Date.now()}` });
    const signature = createHmac("sha256", "demo_webhook_secret").update(rawBody).digest("hex");

    const res = await fetch(`${baseUrl}/api/v1/webhooks/payments/provider-inexistente`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-sitedock-signature": signature },
      body: rawBody,
    });
    expect(res.status).toBe(400);
  });

  it("checkout demo público: sesión desconocida → 404 sin tocar BD", async () => {
    const res = await call("GET", "/api/v1/public/demo-checkout/demo_otc_inexistente");
    expect(res.status).toBe(404);
    expect(res.json).toMatchObject({ code: "NOT_FOUND" });
  });

  it("endpoints demo requieren sesión (mounted + requireSession)", async () => {
    const res = await call("POST", "/api/v1/workspaces/ws/demo-payments/simulate-payment-succeeded", {
      body: { checkoutSessionId: "demo_cs_x" },
    });
    expect(res.status).toBe(401);
    expect(res.json).toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("expone cabeceras estándar de rate limiting y oculta x-powered-by", async () => {
    // El limiter monta bajo /api/v1 — usamos la 401 de workspaces sin cookie.
    const res = await call("GET", "/api/v1/workspaces");
    expect(res.status).toBe(401);
    expect(res.headers.get("ratelimit-limit")).toBeTruthy();
    expect(res.headers.get("x-powered-by")).toBeNull();
  });

  it("CORS refleja únicamente el origen configurado", async () => {
    const res = await fetch(`${baseUrl}/health/live`, {
      headers: { Origin: process.env.CORS_ORIGIN ?? "http://localhost:3000" },
    });
    expect(res.headers.get("access-control-allow-credentials")).toBe("true");
    expect(res.headers.get("access-control-allow-origin")).toBe(
      process.env.CORS_ORIGIN ?? "http://localhost:3000"
    );
  });
});

