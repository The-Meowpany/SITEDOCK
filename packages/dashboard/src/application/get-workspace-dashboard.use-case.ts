import { WorkspaceId } from "@sitedock/shared";
import { DashboardReader } from "../domain/ports";
import {
  buildGrowthSeries,
  buildRevenueSeries,
  churnRate,
  computeAtRiskMrr,
  computeMrr,
  computeTopClients,
  MoneyBreakdown,
} from "../domain/metrics";

export interface WorkspaceDashboard {
  generatedAt: string;
  mrr: MoneyBreakdown[];
  arr: MoneyBreakdown[];
  atRiskMrr: MoneyBreakdown[];
  subscriptions: {
    active: number;
    trialing: number;
    pastDue: number;
    gracePeriod: number;
    suspended: number;
    canceledLast30Days: number;
    /** Percentage 0..1; null when there were no churn candidates. */
    churnRateLast30Days: number | null;
  };
  websites: {
    totalExcludingDeleted: number;
    active: number; // status LIVE
    byStatus: Record<string, number>;
  };
  clients: { total: number; withActiveService: number };
  payments: {
    failedLast30Days: number;
    recentFailed: Array<{ amountCents: number; currency: string; createdAt: string }>;
  };
  maintenanceRequestsPending: number;
  deployments: {
    total: number;
    last30Days: number;
    storageBytes: number;
  };
  revenueByMonth: Array<{ month: string; entries: MoneyBreakdown[] }>;
  subscriptionGrowthByMonth: Array<{ month: string; started: number; canceled: number }>;
  topClients: ReturnType<typeof computeTopClients>;
}

/**
 * Aggregates every metric shown on the Developer Dashboard
 * (docs/ARCHITECTURE.md §18). Read-only: it never mutates any aggregate —
 * it only reads snapshots through DashboardReader and derives metrics with
 * pure functions from domain/metrics.ts.
 *
 * Definitions (kept explicit so the UI never has to guess):
 * - MRR: ACTIVE subscriptions normalized to monthly, per currency.
 * - At-risk MRR: PAST_DUE + GRACE_PERIOD (payment failing but recoverable).
 * - Active websites: status LIVE. Total excludes DELETED.
 * - Client "with active service": has ≥1 website LIVE.
 */
export class GetWorkspaceDashboardUseCase {
  constructor(private readonly reader: DashboardReader) {}

  async execute(workspaceId: string): Promise<WorkspaceDashboard> {
    const ws = WorkspaceId(workspaceId);
    const now = new Date();
    const in30dWindow = new Date(now);
    in30dWindow.setDate(in30dWindow.getDate() - 30);
    const revenueSince = new Date(now);
    revenueSince.setMonth(revenueSince.getMonth() - 5);
    revenueSince.setUTCDate(1);

    const [subscriptions, websites, clientsList, deploymentStats, failedCount, recentFailed, payments, pendingRequests] =
      await Promise.all([
        this.reader.listSubscriptionSnapshots(ws),
        this.reader.listWebsiteSnapshots(ws),
        this.reader.listClientSnapshots(ws),
        this.reader.getDeploymentStats(ws, in30dWindow),
        this.reader.countFailedPaymentsLast30Days(ws, in30dWindow),
        this.reader.listRecentFailedPayments(ws, 5),
        this.reader.listSuccessfulPaymentsSince(ws, revenueSince),
        this.reader.countOpenMaintenanceRequests(ws),
      ]);

    const activeSubs = subscriptions.filter((s) => s.status === "ACTIVE");
    const canceledLast30 = subscriptions.filter(
      (s) => s.cancellationDate && s.cancellationDate >= in30dWindow
    ).length;

    const liveClientIds = new Set(
      websites.filter((w) => w.status === "LIVE" && w.clientId).map((w) => w.clientId!)
    );

    const byStatus: Record<string, number> = {};
    let totalExcludingDeleted = 0;
    for (const w of websites) {
      if (w.status === "DELETED") continue;
      byStatus[w.status] = (byStatus[w.status] ?? 0) + 1;
      totalExcludingDeleted++;
    }

    const mrr = computeMrr(subscriptions);

    return {
      generatedAt: now.toISOString(),
      mrr,
      arr: mrr.map((m) => ({ currency: m.currency, amountCents: m.amountCents * 12 })),
      atRiskMrr: computeAtRiskMrr(subscriptions),
      subscriptions: {
        active: activeSubs.length,
        trialing: subscriptions.filter((s) => s.status === "TRIALING").length,
        pastDue: subscriptions.filter((s) => s.status === "PAST_DUE").length,
        gracePeriod: subscriptions.filter((s) => s.status === "GRACE_PERIOD").length,
        suspended: subscriptions.filter((s) => s.status === "SUSPENDED").length,
        canceledLast30Days: canceledLast30,
        churnRateLast30Days: churnRate(activeSubs.length, canceledLast30),
      },
      websites: {
        totalExcludingDeleted,
        active: websites.filter((w) => w.status === "LIVE").length,
        byStatus,
      },
      clients: {
        total: clientsList.length,
        withActiveService: liveClientIds.size,
      },
      payments: {
        failedLast30Days: failedCount,
        recentFailed: recentFailed.map((p) => ({
          amountCents: p.amountCents,
          currency: p.currency,
          createdAt: p.createdAt.toISOString(),
        })),
      },
      maintenanceRequestsPending: pendingRequests,
      deployments: deploymentStats,
      revenueByMonth: buildRevenueSeries(payments, now),
      subscriptionGrowthByMonth: buildGrowthSeries(subscriptions, now),
      topClients: computeTopClients(subscriptions, websites, clientsList),
    };
  }
}
