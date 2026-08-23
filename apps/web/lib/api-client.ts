const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });

  if (res.status === 204) return undefined as T;

  const body = await res.json().catch(() => null);

  if (!res.ok) {
    throw new ApiError(res.status, body?.code ?? "UNKNOWN_ERROR", body?.message ?? "Something went wrong");
  }

  return body as T;
}

export interface WorkspaceSummary {
  id: string;
  name: string;
  slug: string;
  role: "OWNER" | "ADMIN" | "DEVELOPER" | "CLIENT";
}

export interface WebsiteDetail {
  id: string;
  name: string;
  subdomain: string;
  status:
    | "DRAFT" | "PREVIEW" | "PENDING_APPROVAL" | "APPROVED" | "LIVE"
    | "PAST_DUE" | "GRACE_PERIOD" | "SUSPENDED" | "ARCHIVED" | "DELETED";
  productionDeploymentId: string | null;
  clientId: string | null;
}

export interface SubscriptionDetail {
  id: string;
  status: "INCOMPLETE" | "TRIALING" | "ACTIVE" | "PAST_DUE" | "PAUSED" | "GRACE_PERIOD" | "SUSPENDED" | "CANCELED" | "EXPIRED";
  priceDecimal: string;
  currency: string;
  billingInterval: "MONTHLY" | "YEARLY";
  nextBillingDate: string | null;
  gracePeriodEndsAt: string | null;
  cancellationDate: string | null;
}

export interface MaintenanceRequestSummary {
  id: string;
  title: string;
  description: string;
  status: "OPEN" | "IN_PROGRESS" | "WAITING_CLIENT" | "PENDING_PAYMENT" | "PAID" | "COMPLETED" | "APPROVED" | "CANCELED";
  priceCents: number | null;
  currency: string | null;
  createdAt: string;
}

/** Coverage verdict returned when a request is created (maintenance tiers). */
export interface TierCoverage {
  hasMembership: boolean;
  covered?: boolean;
  quotaIncluded?: number | null;
  usedThisPeriod?: number;
  remaining?: number | null;
  planName?: string;
}

export const api = {
  login: (email: string, password: string) =>
    request<{ userId: string; fullName: string }>("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),

  me: () => request<{ id: string; email: string; fullName: string; platformRole: string }>("/api/v1/auth/me"),

  logout: () => request<void>("/api/v1/auth/logout", { method: "POST" }),

  listWorkspaces: () => request<WorkspaceSummary[]>("/api/v1/workspaces"),

  listWebsites: (workspaceId: string) =>
    request<WebsiteDetail[]>(`/api/v1/workspaces/${workspaceId}/websites`),

  getWebsite: (workspaceId: string, websiteId: string) =>
    request<WebsiteDetail>(`/api/v1/workspaces/${workspaceId}/websites/${websiteId}`),

  getSubscription: (workspaceId: string, websiteId: string, kind: "HOSTING" | "MAINTENANCE" = "HOSTING") =>
    request<SubscriptionDetail | null>(
      `/api/v1/workspaces/${workspaceId}/websites/${websiteId}/subscription?kind=${kind}`
    ).catch((err) => {
      if (err instanceof ApiError && err.status === 404) return null;
      throw err;
    }),

  getAllowance: (workspaceId: string, websiteId: string) =>
    request<
      | { hasMembership: false }
      | {
          hasMembership: true;
          status: SubscriptionDetail["status"];
          planName: string;
          priceDecimal: string;
          currency: string;
          quotaIncluded: number | null;
          usedThisPeriod: number;
          remaining: number | null;
          overQuota: boolean;
        }
    >(`/api/v1/workspaces/${workspaceId}/websites/${websiteId}/maintenance-requests/allowance`),

  listCharges: (workspaceId: string, websiteId: string) =>
    request<
      Array<{
        id: string;
        title: string;
        status: "PENDING" | "PAID" | "CANCELED";
        amountDecimal: string;
        currency: string;
        paidAt: string | null;
        createdAt: string;
      }>
    >(`/api/v1/workspaces/${workspaceId}/websites/${websiteId}/charges`),

  listMaintenanceRequests: (workspaceId: string, websiteId: string) =>
    request<MaintenanceRequestSummary[]>(`/api/v1/workspaces/${workspaceId}/websites/${websiteId}/maintenance-requests`),

  createMaintenanceRequest: (workspaceId: string, websiteId: string, title: string, description: string) =>
    request<{ requestId: string; tier: TierCoverage }>(`/api/v1/workspaces/${workspaceId}/websites/${websiteId}/maintenance-requests`, {
      method: "POST",
      body: JSON.stringify({ title, description }),
    }),

  acceptInvitation: (token: string) =>
    request<{ workspaceId: string }>(`/api/v1/invitations/${token}/accept`, { method: "POST" }),
};
