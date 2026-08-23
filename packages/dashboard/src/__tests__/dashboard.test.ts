import { describe, expect, it } from "vitest";
import { WorkspaceId } from "@sitedock/shared";
import {
  DashboardReader,
  DeploymentStats,
  SubscriptionSnapshot,
} from "../domain/ports";
import {
  buildGrowthSeries,
  buildRevenueSeries,
  churnRate,
  computeAtRiskMrr,
  computeMrr,
  computeTopClients,
  normalizeToMonthlyCents,
} from "../domain/metrics";
import { GetWorkspaceDashboardUseCase } from "../application/get-workspace-dashboard.use-case";

const WS_A = "11111111-1111-1111-1111-111111111111";
const WS_B = "22222222-2222-2222-2222-222222222222";
const CLIENT_A = "33333333-3333-3333-3333-333333333333";

function sub(overrides: Partial<SubscriptionSnapshot> = {}): SubscriptionSnapshot {
  return {
    status: "ACTIVE",
    websiteId: "44444444-4444-4444-4444-444444444444",
    priceCents: 2900,
    currency: "USD",
    billingInterval: "MONTHLY",
    createdAt: new Date("2026-06-15T00:00:00Z"),
    cancellationDate: null,
    ...overrides,
  };
}

interface WorkspaceFixture {
  subscriptions?: SubscriptionSnapshot[];
  websites?: Array<{ id: string; name: string; status: string; clientId: string | null }>;
  clients?: Array<{ id: string; fullName: string; email: string }>;
}

/** Fake reader that only ever returns data belonging to the requested workspace. */
class InMemoryDashboardReader implements DashboardReader {
  readonly queriedWorkspaces: string[] = [];

  constructor(private readonly workspaces: Record<string, WorkspaceFixture> = {}) {}

  private bucket(workspaceId: WorkspaceId): WorkspaceFixture {
    this.queriedWorkspaces.push(workspaceId as string);
    return this.workspaces[workspaceId as string] ?? {};
  }

  async listSubscriptionSnapshots(ws: WorkspaceId) {
    return this.bucket(ws).subscriptions ?? [];
  }
  async listWebsiteSnapshots(ws: WorkspaceId) {
    return this.bucket(ws).websites ?? [];
  }
  async listClientSnapshots(ws: WorkspaceId) {
    return this.bucket(ws).clients ?? [];
  }
  async getDeploymentStats(): Promise<DeploymentStats> {
    return { total: 0, last30Days: 0, storageBytes: 0 };
  }
  async countFailedPaymentsLast30Days() {
    return 0;
  }
  async listRecentFailedPayments() {
    return [];
  }
  async listSuccessfulPaymentsSince() {
    return [];
  }
  async countOpenMaintenanceRequests() {
    return 0;
  }
}

describe("dashboard metrics (pure math)", () => {
  it("normalizes yearly plans to their monthly equivalent", () => {
    expect(normalizeToMonthlyCents(2900, "MONTHLY")).toBe(2900);
    expect(normalizeToMonthlyCents(29000, "YEARLY")).toBe(2417); // rounds, stays integer
  });

  it("computes MRR from ACTIVE subscriptions only", () => {
    const mrr = computeMrr([
      sub({ priceCents: 2900 }),
      sub({ priceCents: 1500 }),
      sub({ priceCents: 12000, status: "PAST_DUE" }), // excluded
      sub({ priceCents: 9900, status: "TRIALING" }), // excluded
    ]);
    expect(mrr).toEqual([{ currency: "USD", amountCents: 4400 }]);
  });

  it("never mixes currencies inside one total", () => {
    const mrr = computeMrr([
      sub({ priceCents: 2900, currency: "USD" }),
      sub({ priceCents: 5000, currency: "EUR" }),
    ]);
    expect(mrr).toEqual([
      { currency: "EUR", amountCents: 5000 },
      { currency: "USD", amountCents: 2900 },
    ]);
  });

  it("counts PAST_DUE and GRACE_PERIOD as at-risk MRR", () => {
    const risk = computeAtRiskMrr([
      sub({ priceCents: 2900, status: "PAST_DUE" }),
      sub({ priceCents: 5900, status: "GRACE_PERIOD" }),
      sub({ priceCents: 1000, status: "SUSPENDED" }), // not recoverable automatically
      sub({ priceCents: 2000 }), // healthy
    ]);
    expect(risk).toEqual([{ currency: "USD", amountCents: 8800 }]);
  });

  it("returns null churn when there are no candidates (empty workspace ≠ 0% churn)", () => {
    expect(churnRate(0, 0)).toBeNull();
    expect(churnRate(10, 2)).toBe(0.167); // 2/12 rounded to thousandths
  });

  it("builds a zero-filled growth series over the last N months", () => {
    const now = new Date("2026-08-20T00:00:00Z");
    const series = buildGrowthSeries(
      [
        sub({ createdAt: new Date("2026-07-10T00:00:00Z") }),
        sub({ createdAt: new Date("2026-08-01T00:00:00Z"), cancellationDate: new Date("2026-08-05T00:00:00Z") }),
        sub({ createdAt: new Date("2026-01-01T00:00:00Z") }), // outside window — ignored
      ],
      now
    );
    expect(series.map((p) => p.month)).toEqual(["2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08"]);
    expect(series.find((p) => p.month === "2026-07")).toEqual({ month: "2026-07", started: 1, canceled: 0 });
    expect(series.find((p) => p.month === "2026-08")).toEqual({ month: "2026-08", started: 1, canceled: 1 });
  });

  it("zero-fills the revenue series and ignores out-of-window payments", () => {
    const now = new Date("2026-08-20T00:00:00Z");
    const series = buildRevenueSeries(
      [
        { amountCents: 2900, currency: "USD", createdAt: new Date("2026-08-02T00:00:00Z") },
        { amountCents: 2900, currency: "USD", createdAt: new Date("2026-08-09T00:00:00Z") },
        { amountCents: 999999, currency: "USD", createdAt: new Date("2025-12-01T00:00:00Z") }, // outside
      ],
      now
    );
    expect(series).toHaveLength(6);
    expect(series.at(-1)).toEqual({
      month: "2026-08",
      entries: [{ currency: "USD", amountCents: 5800 }],
    });
    expect(series[0]?.entries).toEqual([]);
  });

  it("ranks top clients by monthly contribution through website attribution", () => {
    const websites = [
      { id: "w1", name: "A", status: "LIVE", clientId: CLIENT_A },
      { id: "w2", name: "B", status: "LIVE", clientId: null }, // unattributed — skipped
    ];
    const rows = computeTopClients([sub({ websiteId: "w1", priceCents: 2900 })], websites, [
      { id: CLIENT_A, fullName: "Juan Pérez", email: "juan@example.com" },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.fullName).toBe("Juan Pérez");
    expect(rows[0]).toMatchObject({ clientId: CLIENT_A, websites: 1, monthlyCents: 2900 });
  });
});

describe("GetWorkspaceDashboardUseCase", () => {
  it("assembles the full read model from the reader snapshots", async () => {
    const reader = new InMemoryDashboardReader({
      [WS_A]: {
        subscriptions: [
          sub({ websiteId: "w-live", priceCents: 2900 }),
          sub({ priceCents: 12000, billingInterval: "YEARLY" }),
          sub({ priceCents: 5900, status: "GRACE_PERIOD" }),
        ],
        websites: [
          { id: "w-live", name: "Live site", status: "LIVE", clientId: CLIENT_A },
          { id: "w-draft", name: "Draft site", status: "DRAFT", clientId: null },
          { id: "w-dead", name: "Deleted", status: "DELETED", clientId: null }, // excluded from totals
        ],
        clients: [{ id: CLIENT_A, fullName: "Juan Pérez", email: "juan@example.com" }],
      },
    });

    const dashboard = await new GetWorkspaceDashboardUseCase(reader).execute(WS_A);

    // $29.00 monthly + yearly $120.00 normalized to $10.00/month
    expect(dashboard.mrr).toEqual([{ currency: "USD", amountCents: 3900 }]);
    expect(dashboard.arr).toEqual([{ currency: "USD", amountCents: 46800 }]);
    expect(dashboard.atRiskMrr).toEqual([{ currency: "USD", amountCents: 5900 }]);
    expect(dashboard.subscriptions.active).toBe(2);
    expect(dashboard.subscriptions.gracePeriod).toBe(1);
    expect(dashboard.websites.totalExcludingDeleted).toBe(2);
    expect(dashboard.websites.byStatus).toEqual({ DRAFT: 1, LIVE: 1 });
    expect(dashboard.clients.withActiveService).toBe(1);
    expect(dashboard.topClients).toHaveLength(1);
  });

  it("never sees data from another workspace (tenant isolation)", async () => {
    const reader = new InMemoryDashboardReader({
      [WS_A]: {
        subscriptions: [sub({ priceCents: 2900 })],
        websites: [{ id: "w-a", name: "A", status: "LIVE", clientId: null }],
        clients: [],
      },
      [WS_B]: {
        subscriptions: [sub({ priceCents: 999900 })],
        websites: [{ id: "w-b", name: "B", status: "LIVE", clientId: null }],
        clients: [{ id: CLIENT_A, fullName: "Other tenant client", email: "x@y.com" }],
      },
    });

    const dashboard = await new GetWorkspaceDashboardUseCase(reader).execute(WS_A);

    // WS_B's $9,999 subscription must not leak into WS_A's MRR.
    expect(dashboard.mrr).toEqual([{ currency: "USD", amountCents: 2900 }]);
    expect(dashboard.clients.total).toBe(0);
    expect(reader.queriedWorkspaces.every((ws) => ws === WS_A)).toBe(true);
  });
});
