import { describe, expect, it, beforeEach } from "vitest";
import { ResendEmailProvider } from "../infrastructure/resend-email.provider";
import { createEmailProviderFromEnv } from "../infrastructure/email.factory";
import { MockEmailProvider } from "../infrastructure/mock-email.provider";

const email = {
  to: "cliente@ejemplo.com",
  subject: "Pago recibido",
  body: "Gracias por tu pago.",
};

describe("ResendEmailProvider", () => {
  let captured: Array<{ url: string; init: RequestInit }> = [];
  let respond: () => { ok: boolean; status?: number; json: Promise<unknown> };

  function provider() {
    return new ResendEmailProvider({
      apiKey: "re_test_123",
      from: "SiteDock <hola@sitedock.test>",
      apiBase: "https://api.resend.test",
      fetchImpl: (async (url: unknown, init?: RequestInit) => {
        captured.push({ url: String(url), init: init ?? {} });
        const r = respond();
        return { ok: r.ok, status: r.status ?? 200, json: async () => r.json } as Response;
      }) as unknown as typeof fetch,
    });
  }

  beforeEach(() => {
    captured = [];
    respond = () => ({ ok: true, status: 200, json: Promise.resolve({ id: "em_1" }) });
  });

  it("envía POST /emails con Bearer, from verificado y texto plano", async () => {
    await provider().send(email);

    expect(captured).toHaveLength(1);
    const { url, init } = captured[0]!;
    expect(url).toBe("https://api.resend.test/emails");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer re_test_123");

    const payload = JSON.parse(String(init.body));
    expect(payload.from).toBe("SiteDock <hola@sitedock.test>");
    expect(payload.to).toEqual(["cliente@ejemplo.com"]);
    expect(payload.subject).toBe("Pago recibido");
    expect(payload.text).toContain("Gracias");
  });

  it("mapea errores HTTP a InfrastructureError con detalle del proveedor", async () => {
    respond = () => ({ ok: false, status: 422, json: Promise.resolve({ message: "validation_error" }) });
    await expect(provider().send(email)).rejects.toThrow(/validation_error/);
  });

  it("mapea fallos de red a InfrastructureError (fail-safe para el caller)", async () => {
    const broken = new ResendEmailProvider({
      apiKey: "re_test_123",
      from: "x@y.z",
      apiBase: "https://api.resend.test",
      fetchImpl: (async () => {
        throw new Error("ECONNRESET");
      }) as unknown as typeof fetch,
    });
    await expect(broken.send(email)).rejects.toThrow(/ECONNRESET/);
  });
});

describe("createEmailProviderFromEnv", () => {
  it("default = mock", () => {
    const { provider } = createEmailProviderFromEnv({});
    expect(provider).toBeInstanceOf(MockEmailProvider);
  });

  it("EMAIL_PROVIDER=resend construye el provider real con su config", () => {
    const { provider } = createEmailProviderFromEnv({
      EMAIL_PROVIDER: "resend",
      RESEND_API_KEY: "re_x",
      RESEND_FROM: "S <s@x.y>",
    } as NodeJS.ProcessEnv);
    expect(provider).toBeInstanceOf(ResendEmailProvider);
  });
});
