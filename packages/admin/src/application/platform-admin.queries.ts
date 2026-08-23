import { normalizeToMonthlyCents, sumByCurrency } from "@sitedock/shared";
import { PlatformAdminReader } from "../domain/ports";

/**
 * Platform-wide overview (brief §27). Read-only aggregation across every
 * tenant — same CQRS read-side discipline as the Developer Dashboard
 * (packages/dashboard), but without the tenant filter. MRR uses the exact
 * same integer-safe math as the dashboard via @sitedock/shared (ADR-004).
 */
export class GetPlatformOverviewUseCase {
  constructor(private readonly reader: PlatformAdminReader) {}

  async execute() {
    const overview = await this.reader.getOverview();
    const mrrByCurrency = sumByCurrency(
      overview.activeSubscriptionPrices.map((p) => ({
        currency: p.currency,
        amountCents: normalizeToMonthlyCents(p.priceCents, p.billingInterval),
      }))
    );
    return {
      usersTotal: overview.usersTotal,
      workspacesTotal: overview.workspacesTotal,
      websitesByStatus: overview.websitesByStatus,
      activeSubscriptionCount: overview.activeSubscriptionCount,
      failedPaymentsLast30Days: overview.failedPaymentsLast30Days,
      deploymentsTotal: overview.deploymentsTotal,
      storageBytes: overview.storageBytes,
      mrrByCurrency,
      arrByCurrency: mrrByCurrency.map((m) => ({ currency: m.currency, amountCents: m.amountCents * 12 })),
    };
  }
}

export class ListPlatformTenantsUseCase {
  constructor(private readonly reader: PlatformAdminReader) {}
  async execute(limit = 50) {
    return this.reader.listTenants(limit);
  }
}

export class ListPlatformUsersUseCase {
  constructor(private readonly reader: PlatformAdminReader) {}
  async execute(limit = 100) {
    return this.reader.listUsers(limit);
  }
}

export class ListPlatformWebsitesUseCase {
  constructor(private readonly reader: PlatformAdminReader) {}
  async execute(limit = 100) {
    return this.reader.listRecentWebsites(limit);
  }
}

export class ListPlatformPaymentsUseCase {
  constructor(private readonly reader: PlatformAdminReader) {}
  async execute(limit = 50) {
    return this.reader.listRecentPayments(limit);
  }
}

export class ListPlatformWebhookEventsUseCase {
  constructor(private readonly reader: PlatformAdminReader) {}
  async execute(limit = 50) {
    return this.reader.listWebhookEvents(limit);
  }
}
