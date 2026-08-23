/**
 * Read-side port for the Platform Admin panel (docs/ARCHITECTURE.md / brief
 * §27 "Admin Panel"). Unlike every other reader in this codebase, these
 * queries are deliberately NOT workspace-scoped: platform administration
 * legitimately crosses tenants. That privilege is enforced exactly once, at
 * the API boundary, by the requirePlatformAdmin middleware — no route may
 * mount this reader anywhere else.
 */

export interface PlatformOverview {
  usersTotal: number;
  workspacesTotal: number;
  websitesByStatus: Record<string, number>;
  /** Raw snapshots of every ACTIVE subscription — MRR math happens in the use case, not here. */
  activeSubscriptionPrices: Array<{ priceCents: number; currency: string; billingInterval: "MONTHLY" | "YEARLY" }>;
  activeSubscriptionCount: number;
  failedPaymentsLast30Days: number;
  deploymentsTotal: number;
  storageBytes: number;
}

export interface TenantRow {
  id: string;
  name: string;
  slug: string;
  websiteCount: number;
  activeSubscriptionCount: number;
  createdAt: Date;
}

export interface AdminUserRow {
  id: string;
  email: string;
  fullName: string;
  platformRole: string;
  suspendedAt: Date | null;
  createdAt: Date;
}

export interface AdminWebsiteRow {
  id: string;
  name: string;
  subdomain: string;
  status: string;
  workspaceId: string;
  workspaceName: string;
  updatedAt: Date;
}

export interface AdminPaymentRow {
  id: string;
  status: string;
  amountCents: number;
  currency: string;
  provider: string;
  createdAt: Date;
}

export interface AdminWebhookEventRow {
  id: string;
  provider: string;
  eventType: string;
  processingStatus: string;
  receivedAt: Date;
}

/** All implementations MUST honor the limit parameter — never return unbounded lists. */
export interface PlatformAdminReader {
  getOverview(): Promise<PlatformOverview>;
  listTenants(limit: number): Promise<TenantRow[]>;
  listUsers(limit: number): Promise<AdminUserRow[]>;
  listRecentWebsites(limit: number): Promise<AdminWebsiteRow[]>;
  listRecentPayments(limit: number): Promise<AdminPaymentRow[]>;
  listWebhookEvents(limit: number): Promise<AdminWebhookEventRow[]>;
  /** Cross-tenant lookup used by the suspend-website admin action. */
  findWebsiteForAdmin(websiteId: string): Promise<{ id: string; workspaceId: string; name: string } | null>;
}
