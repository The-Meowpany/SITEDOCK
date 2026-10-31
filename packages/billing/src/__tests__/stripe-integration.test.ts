import { createHmac, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { Money } from "@sitedock/shared";
import { StripePaymentProvider, StripePaymentProviderConfig } from "../infrastructure/stripe-payment.provider";
import { verifyStripeSignature } from "../infrastructure/stripe-signature";

const SECRET = "whsec_test_123";
const CONFIG: StripePaymentProviderConfig = {
  secretKey: "sk_test_123",
  webhookSecret: SECRET,
  apiBase: "https://api.stripe.test",
  fetchImpl: (async () => ({ ok: true, json: async () => ({}) })) as unknown as typeof fetch,
};

function sign(payload: string, secret = SECRET, timestampSeconds = Math.floor(Date.now() / 1000)) {
  const signature = createHmac("sha256", secret).update(`${timestampSeconds}.${payload}`).digest("hex");
  return `t=${timestampSeconds},v1=${signature}`;
}

function provider() {
  return new StripePaymentProvider(CONFIG);
}

function envelope(type: string, object: Record<string, unknown>) {
  return JSON.stringify({ id: `evt_${randomUUID()}`, type, data: { object } });
}

describe("verifyStripeSignature (esquema real de Stripe)", () => {
  it("acepta una firma válida", () => {
    const body = Buffer.from('{"type":"ping"}');
    expect(verifyStripeSignature(body, sign(body.toString()), SECRET).valid).toBe(true);
  });

  it("rechaza un payload manipulado tras firmar", () => {
    const body = Buffer.from('{"type":"ping"}');
    const tampered = Buffer.from('{"type":"charge.refunded","amount":999999}');
    expect(verifyStripeSignature(tampered, sign(body.toString()), SECRET)).toMatchObject({
      valid: false,
      reason: "SIGNATURE_MISMATCH",
    });
  });

  it("rechaza timestamps fuera de tolerancia (replay)", () => {
    const body = Buffer.from("{}");
    const stale = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago
    expect(verifyStripeSignature(body, sign(body.toString(), SECRET, stale), SECRET)).toMatchObject({
      valid: false,
      reason: "TIMESTAMP_OUT_OF_TOLERANCE",
    });
  });

  it("rechaza header ausente o malformado", () => {
    expect(verifyStripeSignature(Buffer.from("{}"), "", SECRET)).toMatchObject({ valid: false });
    expect(verifyStripeSignature(Buffer.from("{}"), "garbage", SECRET)).toMatchObject({
      valid: false,
      reason: "MALFORMED_HEADER",
    });
  });
});

describe("StripePaymentProvider — mapeo de eventos reales", () => {
  function parseSigned(raw: string) {
    const p = provider();
    return p.verifyAndParseWebhook(Buffer.from(raw), sign(raw));
  }

  it("checkout.session.completed (subscription) → payment.succeeded vía metadata", () => {
    const raw = envelope("checkout.session.completed", {
      id: "cs_1",
      mode: "subscription",
      amount_total: 2900,
      currency: "usd",
      payment_intent: "pi_1",
      metadata: { subscription_id: "sub-internal-1" },
    });
    expect(parseSigned(raw)).toMatchObject({
      type: "payment.succeeded",
      externalSubscriptionId: "sub-internal-1",
      externalPaymentId: "pi_1",
      amountCents: 2900,
      currency: "USD",
    });
  });

  it("checkout.session.completed (payment) → charge.succeeded vía charge_id metadata", () => {
    const raw = envelope("checkout.session.completed", {
      id: "cs_2",
      mode: "payment",
      amount_total: 150000,
      currency: "usd",
      payment_intent: "pi_2",
      metadata: { charge_id: "charge-internal-9" },
    });
    expect(parseSigned(raw)).toMatchObject({
      type: "charge.succeeded",
      externalChargeId: "charge-internal-9",
      amountCents: 150000,
    });
  });

  it("invoice.payment_failed → payment.failed", () => {
    const raw = envelope("invoice.payment_failed", {
      subscription: "sub_x",
      payment_intent: "pi_fail",
    });
    expect(parseSigned(raw)).toMatchObject({ type: "payment.failed", reason: "invoice_payment_failed" });
  });

  it("customer.subscription.deleted → subscription.canceled", () => {
    const raw = envelope("customer.subscription.deleted", { id: "sub_dead" });
    expect(parseSigned(raw)).toMatchObject({
      type: "subscription.canceled",
      externalSubscriptionId: "sub_dead",
    });
  });

  it("charge.refunded → refund.succeeded con el último refund del array", () => {
    const raw = envelope("charge.refunded", {
      id: "ch_r",
      payment_intent: "pi_r",
      amount_refunded: 5000,
      refunds: { data: [{ id: "re_1", amount: 5000, currency: "usd" }] },
    });
    expect(parseSigned(raw)).toMatchObject({
      type: "refund.succeeded",
      externalRefundId: "re_1",
      externalPaymentId: "pi_r",
      amountCents: 5000,
    });
  });

  it("dispute created/closed mapean a dispute.created/closed con veredicto", () => {
    const created = parseSigned(
      envelope("charge.dispute.created", {
        id: "dp_1",
        payment_intent: "pi_d",
        amount: 2900,
        currency: "usd",
        evidence_details: { due_by: Math.floor(new Date("2026-09-30T00:00:00Z").getTime() / 1000) },
      })
    );
    expect(created).toMatchObject({ type: "dispute.created", externalDisputeId: "dp_1" });

    const closed = parseSigned(envelope("charge.dispute.closed", { id: "dp_1", status: "lost" }));
    expect(closed).toMatchObject({ type: "dispute.closed", won: false });
  });

  it("eventos irrelevantes se ACKean como ignored sin lanzar", () => {
    const raw = envelope("payout.created", { id: "po_1" });
    expect(parseSigned(raw).type).toBe("ignored");
  });

  it("lanza sobre firma inválida incluso si el JSON es válido", () => {
    const raw = envelope("checkout.session.completed", { mode: "subscription" });
    expect(() => provider().verifyAndParseWebhook(Buffer.from(raw), "t=1,v1=deadbeef")).toThrow(/signature/i);
  });
});

describe("StripePaymentProvider — creación de checkouts (HTTP inyectado)", () => {
  it("construye un checkout de suscripción con price_data inline y metadata", async () => {
    const captured: Array<{ method: string; path: string; body?: Record<string, unknown> }> = [];
    const p = new StripePaymentProvider({
      ...CONFIG,
      fetchImpl: (async (url: unknown, init?: RequestInit) => {
        captured.push({
          method: init?.method ?? "GET",
          path: String(url).replace(/^https:\/\/api\.stripe\.test/, ""),
          body: Object.fromEntries(new URLSearchParams(String(init?.body ?? ""))),
        });
        return {
          ok: true,
          json: async () => ({ id: "cs_new", url: "https://checkout.stripe.test/cs_new" }),
        };
      }) as unknown as typeof fetch,
    });

    const session = await p.createCheckoutSession({
      subscriptionId: "sub-internal-7",
      amount: Money.fromCents(2900, "USD"),
      billingInterval: "MONTHLY",
      successUrl: "https://ok",
      cancelUrl: "https://no",
    });

    expect(session.url).toContain("/cs_new");
    const call = captured[0]!;
    expect(call.path).toBe("/checkout/sessions");
    expect(call.body?.["mode"]).toBe("subscription");
    expect(call.body?.["metadata[subscription_id]"]).toBe("sub-internal-7");
    expect(call.body?.["line_items[0][price_data][unit_amount]"]).toBe("2900");
    expect(call.body?.["line_items[0][price_data][recurring][interval]"]).toBe("month");
  });

  it("construye un checkout one-time para charges con client_reference_id = chargeId", async () => {
    const captured: Array<{ body?: Record<string, unknown> }> = [];
    const p = new StripePaymentProvider({
      ...CONFIG,
      fetchImpl: (async (_url: unknown, init?: RequestInit) => {
        captured.push({ body: Object.fromEntries(new URLSearchParams(String(init?.body ?? ""))) });
        return { ok: true, json: async () => ({ id: "cs_otc", url: "u" }) };
      }) as unknown as typeof fetch,
    });

    await p.createOneTimeCheckout({
      chargeId: "charge-42",
      description: "Diseño inicial",
      amount: Money.fromCents(150000, "USD"),
      successUrl: "https://ok",
      cancelUrl: "https://no",
    });

    expect(captured[0]?.body?.["mode"]).toBe("payment");
    expect(captured[0]?.body?.["metadata[charge_id]"]).toBe("charge-42");
  });
});


