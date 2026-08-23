import { MoneyBreakdown, normalizeToMonthlyCents, sumByCurrency } from "@sitedock/shared";
import type { SubscriptionSnapshot, WebsiteSnapshot } from "./ports";

/**
 * Pure metric math for the Developer Dashboard. No I/O, no framework — every
 * function here is deterministic and unit-tested in isolation (docs/ARCHITECTURE.md
 * "CQRS selectivo"): the computation lives on the read side; the write-side
 * aggregates are never involved.
 *
 * Money aggregation primitives (MoneyBreakdown / normalizeToMonthlyCents /
 * sumByCurrency) live in @sitedock/shared so the Platform Admin read model
 * reuses the exact same integer-safe math (ADR-004).
 */

export { MoneyBreakdown, normalizeToMonthlyCents, sumByCurrency };

export type BillingInterval = "MONTHLY" | "YEARLY";

const REVENUE_STATUSES = new Set<SubscriptionSnapshot["status"]>(["ACTIVE"]);

/** Committed MRR: ACTIVE subscriptions only, normalized to monthly per currency. */
export function computeMrr(subscriptions: SubscriptionSnapshot[]): MoneyBreakdown[] {
  return sumByCurrency(
    subscriptions
      .filter((s) => REVENUE_STATUSES.has(s.status))
      .map((s) => ({
        currency: s.currency,
        amountCents: normalizeToMonthlyCents(s.priceCents, s.billingInterval),
      }))
  );
}

const AT_RISK_STATUSES = new Set<SubscriptionSnapshot["status"]>(["PAST_DUE", "GRACE_PERIOD"]);

/** MRR currently at risk because payment failed but recovery is still possible. */
export function computeAtRiskMrr(subscriptions: SubscriptionSnapshot[]): MoneyBreakdown[] {
  return sumByCurrency(
    subscriptions
      .filter((s) => AT_RISK_STATUSES.has(s.status))
      .map((s) => ({
        currency: s.currency,
        amountCents: normalizeToMonthlyCents(s.priceCents, s.billingInterval),
      }))
  );
}

/**
 * Simple churn rate over a window: cancellations divided by the subscribers
 * who could have churned (still active + those who canceled inside the
 * window). Returns null when there were no candidates — an empty workspace
 * has no churn, not 0% churn.
 */
export function churnRate(candidatesAtStart: number, canceledInWindow: number): number | null {
  const denominator = candidatesAtStart + canceledInWindow;
  if (denominator === 0) return null;
  return Math.round((canceledInWindow / denominator) * 1000) / 1000;
}

export interface MonthCountPoint {
  month: string; // "YYYY-MM"
  started: number;
  canceled: number;
}

function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function lastMonthKeys(now: Date, months: number): string[] {
  const keys: string[] = [];
  const cursor = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(cursor);
    d.setUTCMonth(d.getUTCMonth() - i);
    keys.push(monthKey(d));
  }
  return keys;
}

/** Subscription growth series: started vs canceled per month, zero-filled. */
export function buildGrowthSeries(
  subscriptions: SubscriptionSnapshot[],
  now: Date,
  months = 6
): MonthCountPoint[] {
  const keys = lastMonthKeys(now, months);
  const byKey = new Map<string, MonthCountPoint>(keys.map((k) => [k, { month: k, started: 0, canceled: 0 }]));

  for (const sub of subscriptions) {
    const startedBucket = byKey.get(monthKey(sub.createdAt));
    if (startedBucket) startedBucket.started++;
    if (sub.cancellationDate) {
      const canceledBucket = byKey.get(monthKey(sub.cancellationDate));
      if (canceledBucket) canceledBucket.canceled++;
    }
  }

  return keys.map((k) => byKey.get(k)!);
}

export interface RevenueMonthPoint {
  month: string; // "YYYY-MM"
  entries: MoneyBreakdown[];
}

/** Revenue series from succeeded payments, zero-filled for chart continuity. */
export function buildRevenueSeries(
  payments: Array<{ amountCents: number; currency: string; createdAt: Date }>,
  now: Date,
  months = 6
): RevenueMonthPoint[] {
  const keys = lastMonthKeys(now, months);
  const byKey = new Map<string, Map<string, number>>(keys.map((k) => [k, new Map()]));

  for (const p of payments) {
    const key = monthKey(p.createdAt);
    const bucket = byKey.get(key);
    if (!bucket) continue;
    bucket.set(p.currency, (bucket.get(p.currency) ?? 0) + p.amountCents);
  }

  return keys.map((month) => {
    const bucket = byKey.get(month)!;
    return { month, entries: sumByCurrency([...bucket].map(([currency, amountCents]) => ({ currency, amountCents }))) };
  });
}

export interface TopClientRow {
  clientId: string;
  fullName: string;
  email: string;
  websites: number;
  monthlyCents: number;
  currency: string | null;
}

/**
 * Top clients ranked by monthly revenue contribution (ACTIVE subscriptions
 * attributed through website.clientId). Multi-currency workspaces would mix —
 * acceptable for MVP ranking purposes; amounts stay labeled per row.
 */
export function computeTopClients(
  subscriptions: SubscriptionSnapshot[],
  websites: WebsiteSnapshot[],
  clients: Array<{ id: string; fullName: string; email: string }>,
  limit = 5
): TopClientRow[] {
  const clientByWebsite = new Map(websites.map((w) => [w.id, w.clientId]));
  const clientById = new Map(clients.map((c) => [c.id, c]));

  const acc = new Map<string, TopClientRow>();
  for (const sub of subscriptions) {
    if (!REVENUE_STATUSES.has(sub.status)) continue;
    const clientId = clientByWebsite.get(sub.websiteId);
    if (!clientId) continue;
    const client = clientById.get(clientId);
    if (!client) continue;

    const row = acc.get(clientId) ?? {
      clientId,
      fullName: client.fullName,
      email: client.email,
      websites: 0,
      monthlyCents: 0,
      currency: null as string | null,
    };
    row.websites += 1;
    // Rows with mixed currencies keep the first-seen currency label; cents are
    // summed only within the same currency to avoid nonsense totals.
    if (row.currency === null || row.currency === sub.currency) {
      row.monthlyCents += normalizeToMonthlyCents(sub.priceCents, sub.billingInterval);
      row.currency = sub.currency;
    }
    acc.set(clientId, row);
  }

  return [...acc.values()].sort((a, b) => b.monthlyCents - a.monthlyCents).slice(0, limit);
}
