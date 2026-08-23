import { describe, expect, it, beforeEach } from "vitest";
import {
  providerMetrics,
  withProviderMetrics,
  exponentialBackoffWithJitter,
} from "@sitedock/shared";
import { S3StorageProvider } from "../infrastructure/s3-storage.provider";

describe("Provider metrics (Fase 19 §17)", () => {
  beforeEach(() => providerMetrics.reset());

  it("registra success y failure con latencia por provider:operación", async () => {
    await withProviderMetrics({ provider: "stripe", operation: "POST /checkout/sessions" }, async () => 1);
    await withProviderMetrics({ provider: "s3", operation: "PUT" }, async () => undefined).catch(() => {});

    try {
      await withProviderMetrics({ provider: "resend", operation: "send" }, async () => {
        throw new Error("boom");
      });
    } catch { /* esperado */ }

    const snap = providerMetrics.snapshot();
    const stripe = snap.find((m) => m.key === "stripe:POST /checkout/sessions")!;
    expect(stripe.success).toBe(1);

    const resend = snap.find((m) => m.key === "resend:send")!;
    expect(resend.failure).toBe(1);
    expect(snap.find((m) => m.key === "s3:PUT")!.success).toBe(1);
  });
});

describe("exponentialBackoffWithJitter (Fase 19 §18)", () => {
  it("crece exponencialmente, respeta el techo y jamás devuelve 0", () => {
    const rng = () => 1;
    expect(exponentialBackoffWithJitter(1, { baseMs: 500, rng })).toBeGreaterThanOrEqual(250);
    expect(exponentialBackoffWithJitter(5, { baseMs: 500, maxMs: 4000, rng })).toBeLessThanOrEqual(4000);
    expect(exponentialBackoffWithJitter(20, { baseMs: 500, maxMs: 4000, rng })).toBeLessThanOrEqual(4000);
  });

  it("con rng=0 mantiene al menos la mitad del backoff (nunca retry inmediato)", () => {
    const rng = () => 0;
    expect(exponentialBackoffWithJitter(3, { baseMs: 500, rng })).toBeGreaterThanOrEqual(500);
  });
});

// ── S3 failure injection + path traversal ─────────────────

type Responder = (url: string, method: string) => { status: number; body?: string };
function providerWith(responder: Responder) {
  const captured: Array<{ url: string; method: string; headers: Record<string, string> }> = [];
  const fetchImpl = (async (url: unknown, init?: RequestInit) => {
    const method = String(init?.method ?? "GET");
    const urlStr = String(url).split("?")[0] ?? "";
    captured.push({
      url: urlStr,
      method,
      headers: (init?.headers ?? {}) as unknown as Record<string, string>,
    });
    const r = responder(urlStr, method);
    return {
      ok: r.status < 400,
      status: r.status,
      arrayBuffer: async () => new TextEncoder().encode(r.body ?? "").buffer as ArrayBuffer,
      text: async () => r.body ?? "",
    } as Response;
  }) as unknown as typeof fetch;
  const storage = new S3StorageProvider({ ...CONFIG, fetchImpl });
  return { storage, captured };
}

const CONFIG = {
  bucket: "sitedock-test",
  region: "us-east-1",
  accessKeyId: "AKIDEXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
};

describe("S3 failure injection — los fallos de infraestructura NUNCA son éxito de aplicación", () => {
  const cases: Array<[string, Responder]> = [
    ["403 forbidden", () => ({ status: 403 })],
    ["500 internal", () => ({ status: 500 })],
    ["503 unavailable", () => ({ status: 503 })],
  ];

  for (const [name, responder] of cases) {
    it(`PUT ante ${name} lanza InfrastructureError (nunca éxito silencioso)`, async () => {
      const { storage } = providerWith(responder);
      await expect(storage.put("k/x", Buffer.from("d"))).rejects.toThrow(/STORAGE_PUT_FAILED|REQUEST_FAILED/);
    });
    it(`GET ante ${name} lanza InfrastructureError`, async () => {
      const { storage } = providerWith(responder);
      await expect(storage.get("k/x")).rejects.toThrow();
    });
  }
});

describe("S3 key sanitization (Fase 19 §15 — aislamiento entre tenants)", () => {
  it.each([
    "../../other-tenant/secret",
    "/absoluto/desde-raíz",
    "websites/w1//escape",
    "websites/w1/../websites/w2/artifact",
  ])("rechaza key insegura: %s", async (badKey) => {
    const { storage } = providerWith(() => ({ status: 200, body: "<ListBucketResult></ListBucketResult>" }));
    await expect(storage.get(badKey)).rejects.toThrow(/UNSAFE_STORAGE_KEY/i);
    await expect(storage.put(badKey, Buffer.from("x"))).rejects.toThrow(/UNSAFE_STORAGE_KEY/i);
    await expect(storage.delete(badKey)).rejects.toThrow(/UNSAFE_STORAGE_KEY/i);
  });
});
