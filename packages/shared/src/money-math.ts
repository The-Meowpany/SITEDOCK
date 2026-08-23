import { DomainError } from "./errors";

/**
 * Pure money aggregation helpers (ADR-004). Integer minor units only, never
 * float; currencies are never mixed inside one total. Shared by every
 * read-side that aggregates revenue (Developer Dashboard, Platform Admin).
 */

export interface MoneyBreakdown {
  currency: string;
  amountCents: number;
}

export type BillingIntervalUnit = "MONTHLY" | "YEARLY";

/** Yearly plans normalized to their monthly equivalent (integer-safe rounding). */
export function normalizeToMonthlyCents(amountCents: number, interval: BillingIntervalUnit): number {
  if (!Number.isInteger(amountCents)) {
    throw new DomainError("Money amount must be an integer number of minor units", "INVALID_MONEY");
  }
  if (interval === "MONTHLY") return amountCents;
  return Math.round(amountCents / 12);
}

export function sumByCurrency(entries: Array<{ currency: string; amountCents: number }>): MoneyBreakdown[] {
  const totals = new Map<string, number>();
  for (const entry of entries) {
    totals.set(entry.currency, (totals.get(entry.currency) ?? 0) + entry.amountCents);
  }
  return [...totals.entries()]
    .map(([currency, amountCents]) => ({ currency, amountCents }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
}
