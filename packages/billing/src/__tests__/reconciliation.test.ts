import { describe, expect, it } from "vitest";
import { reconcilePayments } from "../domain/money-gateways";

const ledger = (externalPaymentId: string, amountCents = 2900) => ({
  externalPaymentId,
  amountCents,
  currency: "USD",
  externalBalanceTxnId: `txn_${externalPaymentId}`,
});

const stripeEntry = (externalPaymentId: string, amountCents = 2900) => ({
  externalPaymentId,
  balanceTransactionId: `txn_${externalPaymentId}`,
  amountCents,
  feeCents: Math.round(amountCents * 0.029),
  currency: "USD",
});

describe("reconcilePayments (Stripe ↔ ledger, Fase 16 §4)", () => {
  it("sin discrepancias no reporta excepciones", () => {
    expect(reconcilePayments([ledger("pi_ok")], [stripeEntry("pi_ok")])).toEqual([]);
  });

  it("detecta cobros del ledger que Stripe desconoce (caída después del commit)", () => {
    const exceptions = reconcilePayments([ledger("pi_ghost")], []);
    expect(exceptions[0]).toMatchObject({
      kind: "MISSING_BALANCE_TRANSACTION",
      externalPaymentId: "pi_ghost",
    });
  });

  it("detecta divergencia de monto y jamás la corrige en silencio", () => {
    const exceptions = reconcilePayments([ledger("pi_bad", 2900)], [stripeEntry("pi_bad", 100)]);
    expect(exceptions[0]).toMatchObject({ kind: "AMOUNT_MISMATCH", externalPaymentId: "pi_bad" });
    // El ledger NO se muta para "arreglarla".
    expect(ledger("pi_bad").amountCents).toBe(2900);
  });

  it("detecta dinero de Stripe que el ledger no conoce", () => {
    const exceptions = reconcilePayments([], [stripeEntry("pi_unknown")]);
    expect(exceptions[0]).toMatchObject({ kind: "UNKNOWN_BALANCE_TRANSACTION" });
  });
});
