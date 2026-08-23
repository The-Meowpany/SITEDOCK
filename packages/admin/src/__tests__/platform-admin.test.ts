import { describe, expect, it } from "vitest";
import { PlatformAdminReader, PlatformOverview } from "../domain/ports";
import {
  GetPlatformOverviewUseCase,
  ListPlatformTenantsUseCase,
} from "../application/platform-admin.queries";

function overviewFixture(overrides: Partial<PlatformOverview> = {}): PlatformOverview {
  return {
    usersTotal: 3,
    workspacesTotal: 2,
    websitesByStatus: { LIVE: 2, SUSPENDED: 1 },
    activeSubscriptionPrices: [{ priceCents: 2900, currency: "USD", billingInterval: "MONTHLY" }],
    activeSubscriptionCount: 1,
    failedPaymentsLast30Days: 1,
    deploymentsTotal: 7,
    storageBytes: 1024,
    ...overrides,
  };
}

class FakeReader implements PlatformAdminReader {
  constructor(public overview: PlatformOverview = overviewFixture()) {}
  async getOverview() {
    return this.overview;
  }
  async listTenants(limit: number) {
    expect(limit).toBeGreaterThan(0);
    return [];
  }
  async listUsers() {
    return [];
  }
  async listRecentWebsites() {
    return [];
  }
  async listRecentPayments() {
    return [];
  }
  async listWebhookEvents() {
    return [];
  }
  async findWebsiteForAdmin() {
    return null;
  }
}

describe("GetPlatformOverviewUseCase", () => {
  it("computes platform MRR/ARR with the same integer-safe math as the dashboard", async () => {
    const reader = new FakeReader(
      overviewFixture({
        activeSubscriptionPrices: [
          { priceCents: 2900, currency: "USD", billingInterval: "MONTHLY" },
          { priceCents: 12000, currency: "USD", billingInterval: "YEARLY" }, // → $10/mo
          { priceCents: 5000, currency: "EUR", billingInterval: "MONTHLY" },
        ],
        activeSubscriptionCount: 3,
      })
    );

    const result = await new GetPlatformOverviewUseCase(reader).execute();

    expect(result.mrrByCurrency).toEqual([
      { currency: "EUR", amountCents: 5000 },
      { currency: "USD", amountCents: 3900 },
    ]);
    expect(result.arrByCurrency).toEqual([
      { currency: "EUR", amountCents: 60000 },
      { currency: "USD", amountCents: 46800 },
    ]);
    // Raw pass-through metrics stay untouched.
    expect(result.usersTotal).toBe(3);
    expect(result.websitesByStatus).toEqual({ LIVE: 2, SUSPENDED: 1 });
  });

  it("reports zero MRR (never null) for an empty platform", async () => {
    const reader = new FakeReader(overviewFixture({ activeSubscriptionPrices: [], activeSubscriptionCount: 0 }));
    const result = await new GetPlatformOverviewUseCase(reader).execute();
    expect(result.mrrByCurrency).toEqual([]);
    expect(result.arrByCurrency).toEqual([]);
  });
});

describe("List use cases honor the limit contract", () => {
  it("passes an explicit bounded limit to the reader", async () => {
    const reader = new FakeReader();
    const seen: number[] = [];
    reader.listTenants = async (limit) => {
      seen.push(limit);
      return [];
    };
    await new ListPlatformTenantsUseCase(reader).execute(25);
    expect(seen).toEqual([25]);
  });
});
