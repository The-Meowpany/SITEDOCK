import { ApiError } from "./api-error";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

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

export interface MoneyBreakdown {
  currency: string;
  amountCents: number;
}

export type WebsiteStatus =
  | "DRAFT" | "PREVIEW" | "PENDING_APPROVAL" | "APPROVED" | "LIVE"
  | "PAST_DUE" | "GRACE_PERIOD" | "SUSPENDED" | "ARCHIVED" | "DELETED";

export interface WebsiteSummary {
  id: string;
  name: string;
  subdomain: string;
  status: WebsiteStatus;
  projectId?: string;
  clientId: string | null;
  /** Deployment actualmente publicado — undefined en listados viejos. */
  productionDeploymentId?: string | null;
}

export type DomainStatus = "PENDING" | "VERIFYING" | "VERIFIED" | "FAILED";
export type DnsRecordType = "TXT" | "CNAME" | "A";

export interface DomainInstructions {
  recordType: DnsRecordType;
  recordName: string;
  recordValue: string;
  ttl: number;
}

export interface DomainDetail {
  id: string;
  hostname: string;
  status: DomainStatus;
  serviceId: string | null;
  verifiedAt: string | null;
  sslIssuedAt: string | null;
  sslExpiresAt: string | null;
  sslStatus: "NONE" | "PENDING" | "ISSUED" | "FAILED";
  sslError: string | null;
  routingOk: boolean;
  routingCheckedAt: string | null;
  routingObserved: string[];
  lastError: string | null;
  provider: string;
  autoManaged: boolean;
  dnsRecord: { type: string | null; name: string | null; value: string | null };
  instructions: DomainInstructions | null;
}

export interface DomainListResponse {
  provider: string;
  managed: boolean;
  domains: DomainDetail[];
}

export interface ServiceSummary {
  id: string;
  projectId: string;
  name: string;
  type: string;
  status: string;
  hostname: string;
  activeDeploymentId: string | null;
}

export interface GitHubRepository {
  id: string;
  name: string;
  fullName: string;
  private: boolean;
}

export interface GitHubConnection {
  id: string;
  installationId: string;
  repositoryId: string;
  repositoryName: string;
  repositoryFullName: string;
  defaultBranch: string;
  serviceId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ApiTokenSummary {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface CreatedApiToken extends ApiTokenSummary {
  token: string;
}

export interface ProjectSummary {
  id: string;
  name: string;
  createdAt: string;
}

export type DeploymentStatus = "QUEUED" | "BUILDING" | "READY" | "PUBLISHED" | "FAILED" | "CANCELED";

export interface DeploymentSummary {
  id: string;
  version: number;
  status: DeploymentStatus;
  createdAt: string;
  publishedAt: string | null;
}

export interface ClientSummary {
  id: string;
  fullName: string;
  email: string;
}

export type PlanKind = "HOSTING" | "MAINTENANCE";

export interface PlanDetail {
  id: string;
  name: string;
  kind: PlanKind;
  priceDecimal: string;
  currency: string;
  billingInterval: "MONTHLY" | "YEARLY";
  includedRequestQuota: number | null;
  active: boolean;
}

export type SubscriptionStatus =
  | "INCOMPLETE" | "TRIALING" | "ACTIVE" | "PAST_DUE" | "PAUSED"
  | "GRACE_PERIOD" | "SUSPENDED" | "CANCELED" | "EXPIRED";

export interface SubscriptionDetail {
  id: string;
  kind: PlanKind;
  status: SubscriptionStatus;
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

export interface TierCoverage {
  hasMembership: boolean;
  covered?: boolean;
  quotaIncluded?: number | null;
  usedThisPeriod?: number;
  remaining?: number | null;
  planName?: string;
}

export interface ChargeSummary {
  id: string;
  title: string;
  status: "PENDING" | "PAID" | "CANCELED";
  amountDecimal: string;
  currency: string;
  paidAt: string | null;
  createdAt: string;
}

export interface DashboardData {
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
    churnRateLast30Days: number | null;
  };
  websites: { totalExcludingDeleted: number; active: number; byStatus: Record<string, number> };
  clients: { total: number; withActiveService: number };
  payments: {
    failedLast30Days: number;
    recentFailed: Array<{ amountCents: number; currency: string; createdAt: string }>;
  };
  maintenanceRequestsPending: number;
  deployments: { total: number; last30Days: number; storageBytes: number };
  revenueByMonth: Array<{ month: string; entries: MoneyBreakdown[] }>;
  subscriptionGrowthByMonth: Array<{ month: string; started: number; canceled: number }>;
  topClients: Array<{
    clientId: string;
    fullName: string;
    email: string;
    websites: number;
    monthlyCents: number;
    currency: string | null;
  }>;
}

export const api = {
  // ── Auth ─────────────────────────────────────────────────
  login: (email: string, password: string) =>
    request<{ userId: string; fullName: string }>("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),

  me: () => request<{ id: string; email: string; fullName: string }>("/api/v1/auth/me"),

  logout: () => request<void>("/api/v1/auth/logout", { method: "POST" }),

  requestPasswordReset: (email: string) =>
    request<{ message: string }>("/api/v1/auth/password-reset/request", {
      method: "POST",
      body: JSON.stringify({ email }),
    }),

  confirmPasswordReset: (token: string, newPassword: string) =>
    request<void>("/api/v1/auth/password-reset/confirm", {
      method: "POST",
      body: JSON.stringify({ token, newPassword }),
    }),

  // ── Workspaces / métricas ────────────────────────────────
  listWorkspaces: () => request<WorkspaceSummary[]>("/api/v1/workspaces"),

  getDashboard: (workspaceId: string) =>
    request<DashboardData>(`/api/v1/workspaces/${workspaceId}/dashboard`),

  // ── API tokens ───────────────────────────────────────────
  listApiTokens: (workspaceId: string) =>
    request<ApiTokenSummary[]>(`/api/v1/workspaces/${workspaceId}/api-tokens`),

  createApiToken: (
    workspaceId: string,
    input: { name: string; scopes?: Array<"read" | "write">; expiresAt?: string }
  ) =>
    request<CreatedApiToken>(`/api/v1/workspaces/${workspaceId}/api-tokens`, {
      method: "POST",
      body: JSON.stringify(input),
    }),

  revokeApiToken: (workspaceId: string, tokenId: string) =>
    request<void>(`/api/v1/workspaces/${workspaceId}/api-tokens/${tokenId}`, {
      method: "DELETE",
    }),

  // ── Proyectos y sitios ───────────────────────────────────
  listProjects: (workspaceId: string) =>
    request<ProjectSummary[]>(`/api/v1/workspaces/${workspaceId}/projects`),

  createProject: (workspaceId: string, name: string) =>
    request<{ projectId: string }>(`/api/v1/workspaces/${workspaceId}/projects`, {
      method: "POST",
      body: JSON.stringify({ name }),
    }),

  listWebsites: (workspaceId: string) =>
    request<WebsiteSummary[]>(`/api/v1/workspaces/${workspaceId}/websites`),

  getWebsite: (workspaceId: string, websiteId: string) =>
    request<WebsiteSummary>(`/api/v1/workspaces/${workspaceId}/websites/${websiteId}`),

  createWebsite: (workspaceId: string, projectId: string, name: string) =>
    request<{ websiteId: string }>(`/api/v1/workspaces/${workspaceId}/websites`, {
      method: "POST",
      body: JSON.stringify({ projectId, name }),
    }),

  submitForApproval: (workspaceId: string, websiteId: string) =>
    request<void>(`/api/v1/workspaces/${workspaceId}/websites/${websiteId}/submit-for-approval`, { method: "POST" }),

  approveWebsite: (workspaceId: string, websiteId: string) =>
    request<void>(`/api/v1/workspaces/${workspaceId}/websites/${websiteId}/approve`, { method: "POST" }),

  rollbackWebsite: (workspaceId: string, websiteId: string, targetDeploymentId: string) =>
    request<void>(`/api/v1/workspaces/${workspaceId}/websites/${websiteId}/rollback`, {
      method: "POST",
      body: JSON.stringify({ targetDeploymentId }),
    }),

  // ── Deployments ──────────────────────────────────────────
  listDomains: (workspaceId: string, websiteId: string) =>
    request<DomainListResponse>(
      `/api/v1/workspaces/${workspaceId}/websites/${websiteId}/domains`
    ),

  registerDomain: (
    workspaceId: string,
    websiteId: string,
    hostname: string,
    options: { serviceId?: string | null; autoManage?: boolean } = {}
  ) =>
    request<{
      domainId: string;
      hostname: string;
      status: DomainStatus;
      provider: string;
      recordName: string;
      recordValue: string;
      routing: DomainInstructions | null;
      autoManaged: boolean;
    }>(`/api/v1/workspaces/${workspaceId}/websites/${websiteId}/domains`, {
      method: "POST",
      body: JSON.stringify({ hostname, ...options }),
    }),

  verifyDomain: (workspaceId: string, websiteId: string, domainId: string) =>
    request<{
      verified: boolean;
      routingOk: boolean;
      sslStatus: string;
      sslExpiresAt: string | null;
      message: string | null;
    }>(
      `/api/v1/workspaces/${workspaceId}/websites/${websiteId}/domains/${domainId}/verify`,
      { method: "POST", body: "{}" }
    ),

  checkDomain: (workspaceId: string, websiteId: string, domainId: string) =>
    request<{
      verified: boolean;
      routingOk: boolean;
      sslStatus: string;
      sslExpiresAt: string | null;
      message: string | null;
    }>(
      `/api/v1/workspaces/${workspaceId}/websites/${websiteId}/domains/${domainId}/check`,
      { method: "POST", body: "{}" }
    ),

  deleteDomain: (workspaceId: string, websiteId: string, domainId: string) =>
    request<void>(
      `/api/v1/workspaces/${workspaceId}/websites/${websiteId}/domains/${domainId}`,
      { method: "DELETE" }
    ),

  listServices: (workspaceId: string, projectId: string) =>
    request<ServiceSummary[]>(
      `/api/v1/workspaces/${workspaceId}/services?projectId=${encodeURIComponent(projectId)}`
    ),

  listGitHubRepositories: (workspaceId: string, websiteId: string, installationId: string) =>
    request<{ installationId: string; repositories: GitHubRepository[] }>(
      `/api/v1/workspaces/${workspaceId}/websites/${websiteId}/github/repositories?installationId=${encodeURIComponent(installationId)}`
    ),

  listGitHubConnections: (workspaceId: string, websiteId: string) =>
    request<GitHubConnection[]>(
      `/api/v1/workspaces/${workspaceId}/websites/${websiteId}/github`
    ),

  connectGitHub: (
    workspaceId: string,
    websiteId: string,
    input: {
      installationId: string;
      repositoryId: string;
      repositoryFullName: string;
      defaultBranch?: string;
      serviceId?: string | null;
    }
  ) =>
    request<GitHubConnection>(
      `/api/v1/workspaces/${workspaceId}/websites/${websiteId}/github`,
      { method: "POST", body: JSON.stringify(input) }
    ),

  disconnectGitHub: (workspaceId: string, websiteId: string, connectionId: string) =>
    request<void>(
      `/api/v1/workspaces/${workspaceId}/websites/${websiteId}/github/${connectionId}`,
      { method: "DELETE" }
    ),

  listDeployments: (workspaceId: string, websiteId: string) =>
    request<DeploymentSummary[]>(
      `/api/v1/workspaces/${workspaceId}/websites/${websiteId}/deployments`
    ),

  /** Multipart ZIP upload — el browser setea el boundary, no va Content-Type manual. */
  uploadDeployment: async (workspaceId: string, websiteId: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<{ deploymentId: string; version: number; previewUrl: string }>(
      `/api/v1/workspaces/${workspaceId}/websites/${websiteId}/deployments`,
      { method: "POST", body: form }
    );
  },

  publishDeployment: (workspaceId: string, websiteId: string, deploymentId: string) =>
    request<void>(
      `/api/v1/workspaces/${workspaceId}/websites/${websiteId}/deployments/${deploymentId}/publish`,
      { method: "POST" }
    ),

  // ── Clientes ─────────────────────────────────────────────
  listClients: (workspaceId: string) =>
    request<ClientSummary[]>(`/api/v1/workspaces/${workspaceId}/clients`),

  createClient: (workspaceId: string, fullName: string, email: string) =>
    request<{ clientId: string }>(`/api/v1/workspaces/${workspaceId}/clients`, {
      method: "POST",
      body: JSON.stringify({ fullName, email }),
    }),

  /** Devuelve inviteUrl solo en modo demo; en producción viaja por email. */
  inviteClientToPortal: (workspaceId: string, email: string) =>
    request<{ invitationId: string; inviteUrl?: string }>(`/api/v1/workspaces/${workspaceId}/invitations`, {
      method: "POST",
      body: JSON.stringify({ email, role: "CLIENT" }),
    }),

  assignClientToWebsite: (workspaceId: string, websiteId: string, clientId: string) =>
    request<void>(`/api/v1/workspaces/${workspaceId}/websites/${websiteId}/subscription/assign-client`, {
      method: "POST",
      body: JSON.stringify({ clientId }),
    }),

  // ── Planes y tiers ───────────────────────────────────────
  listPlans: (workspaceId: string, kind?: PlanKind) =>
    request<PlanDetail[]>(`/api/v1/workspaces/${workspaceId}/plans${kind ? `?kind=${kind}` : ""}`),

  createPlan: (
    workspaceId: string,
    data: {
      name: string;
      kind: PlanKind;
      priceDecimal: string;
      currency: string;
      billingInterval: "MONTHLY" | "YEARLY";
      includedRequestQuota?: number | null;
    }
  ) =>
    request<{ planId: string }>(`/api/v1/workspaces/${workspaceId}/plans`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  updatePlan: (
    workspaceId: string,
    planId: string,
    patch: Partial<{
      name: string;
      priceDecimal: string;
      currency: string;
      billingInterval: "MONTHLY" | "YEARLY";
      includedRequestQuota: number | null;
      active: boolean;
    }>
  ) =>
    request<{ planId: string }>(`/api/v1/workspaces/${workspaceId}/plans/${planId}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),

  // ── Suscripciones y checkout ─────────────────────────────
  getSubscription: (workspaceId: string, websiteId: string, kind: PlanKind = "HOSTING") =>
    request<SubscriptionDetail | null>(
      `/api/v1/workspaces/${workspaceId}/websites/${websiteId}/subscription?kind=${kind}`
    ).catch((err) => {
      if (err instanceof ApiError && err.status === 404) return null;
      throw err;
    }),

  createSubscription: (workspaceId: string, websiteId: string, planId: string) =>
    request<{ subscriptionId: string; kind: PlanKind }>(
      `/api/v1/workspaces/${workspaceId}/websites/${websiteId}/subscription`,
      { method: "POST", body: JSON.stringify({ planId }) }
    ),

  createCheckoutLink: (workspaceId: string, websiteId: string, subscriptionId: string) =>
    request<{ checkoutUrl: string }>(
      `/api/v1/workspaces/${workspaceId}/websites/${websiteId}/subscription/${subscriptionId}/checkout`,
      { method: "POST", body: "{}" }
    ),

  // ── Mantenimiento ────────────────────────────────────────
  listMaintenanceRequests: (workspaceId: string, websiteId: string) =>
    request<MaintenanceRequestSummary[]>(
      `/api/v1/workspaces/${workspaceId}/websites/${websiteId}/maintenance-requests`
    ),

  getAllowance: (workspaceId: string, websiteId: string) =>
    request<
      | { hasMembership: false }
      | {
          hasMembership: true;
          status: SubscriptionStatus;
          planName: string;
          priceDecimal: string;
          currency: string;
          billingInterval: "MONTHLY" | "YEARLY";
          nextBillingDate: string | null;
          quotaIncluded: number | null;
          usedThisPeriod: number;
          remaining: number | null;
          overQuota: boolean;
        }
    >(`/api/v1/workspaces/${workspaceId}/websites/${websiteId}/maintenance-requests/allowance`),

  quoteRequest: (workspaceId: string, websiteId: string, requestId: string, priceDecimal: string, currency = "USD") =>
    request<void>(
      `/api/v1/workspaces/${workspaceId}/websites/${websiteId}/maintenance-requests/${requestId}/quote`,
      { method: "POST", body: JSON.stringify({ priceDecimal, currency }) }
    ),

  startRequest: (workspaceId: string, websiteId: string, requestId: string) =>
    request<void>(
      `/api/v1/workspaces/${workspaceId}/websites/${websiteId}/maintenance-requests/${requestId}/start`,
      { method: "POST" }
    ),

  completeRequest: (workspaceId: string, websiteId: string, requestId: string) =>
    request<void>(
      `/api/v1/workspaces/${workspaceId}/websites/${websiteId}/maintenance-requests/${requestId}/complete`,
      { method: "POST" }
    ),

  approveRequest: (workspaceId: string, websiteId: string, requestId: string) =>
    request<void>(
      `/api/v1/workspaces/${workspaceId}/websites/${websiteId}/maintenance-requests/${requestId}/approve`,
      { method: "POST" }
    ),

  markPaidRequest: (workspaceId: string, websiteId: string, requestId: string) =>
    request<void>(
      `/api/v1/workspaces/${workspaceId}/websites/${websiteId}/maintenance-requests/${requestId}/mark-paid`,
      { method: "POST" }
    ),

  // ── Stripe Connect (merchant) ────────────────────────────
  getMerchantStatus: (workspaceId: string) =>
    request<
      | { status: "NOT_CONNECTED" }
      | {
          status: "PENDING_ONBOARDING" | "ACTIVE" | "RESTRICTED" | "DISCONNECTED";
          chargesEnabled: boolean;
          payoutsEnabled: boolean;
          disabledReason: string | null;
          onboardedAt: string | null;
        }
    >(`/api/v1/workspaces/${workspaceId}/merchant/status`),

  connectMerchant: (workspaceId: string, country = "US") =>
    request<{ accountId: string; onboarded: boolean; url: string }>(
      `/api/v1/workspaces/${workspaceId}/merchant/connect`,
      { method: "POST", body: JSON.stringify({ country }) }
    ),

  // ── Cobros únicos (project fee) ──────────────────────────
  listCharges: (workspaceId: string, websiteId: string) =>
    request<ChargeSummary[]>(`/api/v1/workspaces/${workspaceId}/websites/${websiteId}/charges`),

  createCharge: (workspaceId: string, websiteId: string, title: string, priceDecimal: string, currency = "USD") =>
    request<{ chargeId: string; checkoutUrl: string }>(
      `/api/v1/workspaces/${workspaceId}/websites/${websiteId}/charges`,
      { method: "POST", body: JSON.stringify({ title, priceDecimal, currency }) }
    ),

  cancelCharge: (workspaceId: string, websiteId: string, chargeId: string) =>
    request<void>(`/api/v1/workspaces/${workspaceId}/websites/${websiteId}/charges/${chargeId}/cancel`, {
      method: "POST",
    }),
};
