import { WorkspaceId } from "@sitedock/shared";

/**
 * Read-side port for the Developer Dashboard (docs/ARCHITECTURE.md §18).
 *
 * The dashboard is a CROSS-CONTEXT read model: it aggregates Subscription,
 * Website, Client, Payment and Deployment data without ever mutating any of
 * them. Following the CQRS-lite convention of this codebase, the read side is
 * a dedicated port returning plain snapshots — no domain entities, no ORM
 * types. The Prisma implementation lives in infrastructure/.
 */

/** Minimal projection of a subscription needed to compute MRR/churn/growth. */
export interface SubscriptionSnapshot {
  status:
    | "INCOMPLETE"
    | "TRIALING"
    | "ACTIVE"
    | "PAST_DUE"
    | "PAUSED"
    | "GRACE_PERIOD"
    | "SUSPENDED"
    | "CANCELED"
    | "EXPIRED";
  websiteId: string;
  priceCents: number;
  currency: string;
  billingInterval: "MONTHLY" | "YEARLY";
  createdAt: Date;
  cancellationDate: Date | null;
}

export interface WebsiteSnapshot {
  id: string;
  name: string;
  status: string;
  clientId: string | null;
}

export interface ClientSnapshot {
  id: string;
  fullName: string;
  email: string;
}

export interface FailedPaymentSnapshot {
  amountCents: number;
  currency: string;
  createdAt: Date;
}

export interface SuccessfulPaymentSnapshot {
  amountCents: number;
  currency: string;
  createdAt: Date;
}

export interface DeploymentStats {
  total: number;
  last30Days: number;
  /** Sum of immutable deployment artifact sizes — actual object-storage usage. */
  storageBytes: number;
}

/**
 * All methods are workspace-scoped by contract: implementations MUST filter by
 * workspaceId in every query (tenant isolation is enforced again at the API
 * boundary via AssertWorkspaceAccessUseCase, but defense in depth starts here).
 */
export interface DashboardReader {
  listSubscriptionSnapshots(workspaceId: WorkspaceId): Promise<SubscriptionSnapshot[]>;
  listWebsiteSnapshots(workspaceId: WorkspaceId): Promise<WebsiteSnapshot[]>;
  listClientSnapshots(workspaceId: WorkspaceId): Promise<ClientSnapshot[]>;
  getDeploymentStats(workspaceId: WorkspaceId, since30Days: Date): Promise<DeploymentStats>;
  countFailedPaymentsLast30Days(workspaceId: WorkspaceId, since30Days: Date): Promise<number>;
  listRecentFailedPayments(workspaceId: WorkspaceId, limit: number): Promise<FailedPaymentSnapshot[]>;
  listSuccessfulPaymentsSince(workspaceId: WorkspaceId, since: Date): Promise<SuccessfulPaymentSnapshot[]>;
  /** Requests not yet in a terminal state (COMPLETED/APPROVED/CANCELED). */
  countOpenMaintenanceRequests(workspaceId: WorkspaceId): Promise<number>;
}
