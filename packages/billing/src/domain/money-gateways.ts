import { Money, WorkspaceId } from "@sitedock/shared";

/**
 * MONEY MOVEMENT GATEWAYS — Phase 16 (ADR-006).
 *
 * Stripe is an EXTERNAL AUTHORITY: SiteDock never marks money moved because a
 * frontend said so — only verified provider events do. These ports keep every
 * live HTTP call behind a seam so the entire money logic is testable against
 * fakes offline (sandbox-first), while the production adapter speaks real
 * Stripe REST.
 */

// ── Connect (merchant onboarding) ─────────────────────────

export type ConnectedAccountState = {
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  disabledReason?: string;
};

export interface ConnectedAccountGateway {
  /** Creates an Express connected account for the merchant. */
  createAccount(workspaceId: WorkspaceId, country: string): Promise<{ externalAccountId: string }>;
  /** Hosted onboarding link — KYC/KYB is entirely Stripe's surface. */
  createOnboardingLink(
    externalAccountId: string,
    returnUrl: string,
    refreshUrl: string
  ): Promise<{ url: string; expiresAt: Date }>;
  retrieveAccountStatus(externalAccountId: string): Promise<ConnectedAccountState>;
}

// ── Refunds ───────────────────────────────────────────────

export interface RefundGateway {
  /** amountCents omitted = full refund. Returns the provider's refund reference. */
  createRefund(params: {
    externalPaymentId: string;
    amountCents?: number;
    currency: string;
  }): Promise<{ externalRefundId: string; status: "SUCCEEDED" | "PENDING" }>;
}

// ── Stripe ↔ ledger reconciliation ────────────────────────

export interface BalanceTransactionEntry {
  /** The payment this balance transaction settles (payment intent reference). */
  externalPaymentId: string;
  balanceTransactionId: string;
  amountCents: number;
  feeCents: number;
  currency: string;
}

export interface ReconciliationSource {
  /** Official Stripe-side money movements since the given instant. */
  listBalanceTransactions(createdSince: Date): Promise<BalanceTransactionEntry[]>;
}

// ── Pure reconciliation (no I/O, tested in isolation) ──

export type ReconciliationExceptionKind =
  | "MISSING_BALANCE_TRANSACTION" // ledger says collected, Stripe does not have it
  | "AMOUNT_MISMATCH" // amounts diverge — never "corrected" silently
  | "UNKNOWN_BALANCE_TRANSACTION"; // Stripe moved money that the ledger does not know about

export interface ReconciliationException {
  kind: ReconciliationExceptionKind;
  externalPaymentId: string | null;
  detail: string;
}

export interface LedgerSidePayment {
  externalPaymentId: string;
  amountCents: number;
  currency: string;
  externalBalanceTxnId: string | null;
}

/**
 * Compares the internal ledger against the external authority and produces explicit
 * EXCEPTIONS. Brief §4 rule: a discrepancy is never fixed by silently mutating
 * balances — it is declared for human investigation.
 */
export function reconcilePayments(
  ledgerPayments: LedgerSidePayment[],
  stripeEntries: BalanceTransactionEntry[]
): ReconciliationException[] {
  const exceptions: ReconciliationException[] = [];
  const stripeByPayment = new Map<string, BalanceTransactionEntry>();

  for (const entry of stripeEntries) {
    const existing = stripeByPayment.get(entry.externalPaymentId);
    // If Stripe returns more than one balance txn per payment, the first divergence is already an exception.
    if (existing && existing.balanceTransactionId !== entry.balanceTransactionId) {
      exceptions.push({
        kind: "AMOUNT_MISMATCH",
        externalPaymentId: entry.externalPaymentId,
        detail: `Multiple balance transactions (${existing.balanceTransactionId}, ${entry.balanceTransactionId})`,
      });
    }
    stripeByPayment.set(entry.externalPaymentId, entry);
  }

  for (const payment of ledgerPayments) {
    const entry = stripeByPayment.get(payment.externalPaymentId);
    if (!entry) {
      exceptions.push({
        kind: "MISSING_BALANCE_TRANSACTION",
        externalPaymentId: payment.externalPaymentId,
        detail: `Ledger has ${payment.amountCents} ${payment.currency} settled but Stripe has no balance transaction since window start`,
      });
      continue;
    }
    if (entry.amountCents !== payment.amountCents || entry.currency !== payment.currency) {
      exceptions.push({
        kind: "AMOUNT_MISMATCH",
        externalPaymentId: payment.externalPaymentId,
        detail: `Ledger ${payment.amountCents} ${payment.currency} vs Stripe ${entry.amountCents} ${entry.currency}`,
      });
    }
    stripeByPayment.delete(payment.externalPaymentId);
  }

  for (const [externalPaymentId, entry] of stripeByPayment) {
    exceptions.push({
      kind: "UNKNOWN_BALANCE_TRANSACTION",
      externalPaymentId,
      detail: `Stripe settled ${entry.amountCents} ${entry.currency} (fee ${entry.feeCents}) with no matching ledger payment`,
    });
  }

  return exceptions;
}

/** Helper re-exported so adapters convert without touching floats. */
export function centsFromMajor(amountMajor: number): number {
  return Math.round(amountMajor * 100);
}

export interface MoneyGateways {
  connectedAccounts: ConnectedAccountGateway;
  refunds: RefundGateway;
  reconciliation: ReconciliationSource;
}

export type { Money };
