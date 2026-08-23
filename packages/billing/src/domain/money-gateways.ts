import { Money, WorkspaceId } from "@sitedock/shared";

/**
 * MONEY MOVEMENT GATEWAYS — Fase 16 (ADR-006).
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

// ── Reconciliación Stripe ↔ ledger ────────────────────────

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

// ── Reconciliación pura (sin I/O, testeada en aislamiento) ──

export type ReconciliationExceptionKind =
  | "MISSING_BALANCE_TRANSACTION" // ledger dice cobrado, Stripe no lo tiene
  | "AMOUNT_MISMATCH" // montos divergen — jamás se "corrige" en silencio
  | "UNKNOWN_BALANCE_TRANSACTION"; // Stripe movió dinero que el ledger no conoce

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
 * Compara el ledger interno contra la autoridad externa y produce EXCEPCIONES
 * explícitas. Regla del brief §4: una discrepancia nunca se arregla mutando
 * saldos en silencio — se declara para investigación humana.
 */
export function reconcilePayments(
  ledgerPayments: LedgerSidePayment[],
  stripeEntries: BalanceTransactionEntry[]
): ReconciliationException[] {
  const exceptions: ReconciliationException[] = [];
  const stripeByPayment = new Map<string, BalanceTransactionEntry>();

  for (const entry of stripeEntries) {
    const existing = stripeByPayment.get(entry.externalPaymentId);
    // Si Stripe trae más de un balance txn por pago, la primera divergencia ya es excepción.
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
