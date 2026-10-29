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

export interface MoneyEntry {
  currency: string;
  amountCents: number;
}

export interface PlatformOverview {
  usersTotal: number;
  workspacesTotal: number;
  websitesByStatus: Record<string, number>;
  activeSubscriptionCount: number;
  failedPaymentsLast30Days: number;
  deploymentsTotal: number;
  storageBytes: number;
  mrrByCurrency: MoneyEntry[];
  arrByCurrency: MoneyEntry[];
}

export interface TenantRow {
  id: string;
  name: string;
  slug: string;
  websiteCount: number;
  activeSubscriptionCount: number;
  createdAt: string;
}

export interface AdminUserRow {
  id: string;
  email: string;
  fullName: string;
  platformRole: "PLATFORM_ADMIN" | "DEVELOPER" | "CLIENT";
  suspendedAt: string | null;
  createdAt: string;
}

export interface AdminWebsiteRow {
  id: string;
  name: string;
  subdomain: string;
  status: string;
  workspaceId: string;
  workspaceName: string;
  updatedAt: string;
}

export interface AdminPaymentRow {
  id: string;
  status: string;
  amountCents: number;
  currency: string;
  provider: string;
  createdAt: string;
}

export interface AdminWebhookEventRow {
  id: string;
  provider: string;
  eventType: string;
  processingStatus: string;
  receivedAt: string;
}

export interface AdminDnsStatus {
  configured: boolean;
  baseDomain: string | null;
  zoneFound?: boolean;
  zone?: { id: string; fullDomain: string; status: string; expiresAt: string | null } | null;
  zoneCount?: number;
  publicIpConfigured: boolean;
  recordCount?: number;
  records?: Array<{ name: string; type: string; value: string; ttl: number }>;
  message?: string;
}

export interface DnsProvisionResult {
  changed: boolean;
  applied: boolean;
  zone: string;
  records: Array<{ name: string; type: string; value: string; action: "create" | "exists" | "conflict" }>;
}

export const api = {
  login: (email: string, password: string) =>
    request<{ userId: string; fullName: string }>("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),

  me: () => request<{ id: string; email: string; fullName: string; platformRole: string }>("/api/v1/auth/me"),

  logout: () => request<void>("/api/v1/auth/logout", { method: "POST" }),

  getOverview: () => request<PlatformOverview>("/api/v1/admin/overview"),

  listTenants: () => request<TenantRow[]>("/api/v1/admin/workspaces"),

  listUsers: () => request<AdminUserRow[]>("/api/v1/admin/users"),

  suspendUser: (id: string) =>
    request<{ userId: string; suspendedAt: string | null }>(`/api/v1/admin/users/${id}/suspend`, { method: "POST" }),

  reinstateUser: (id: string) =>
    request<{ userId: string; suspendedAt: string | null }>(`/api/v1/admin/users/${id}/reinstate`, { method: "POST" }),

  listWebsites: () => request<AdminWebsiteRow[]>("/api/v1/admin/websites"),

  suspendWebsite: (id: string) =>
    request<void>(`/api/v1/admin/websites/${id}/suspend`, { method: "POST" }),

  listPayments: () => request<AdminPaymentRow[]>("/api/v1/admin/payments"),

  listWebhookEvents: () => request<AdminWebhookEventRow[]>("/api/v1/admin/webhook-events"),

  getDnsStatus: () => request<AdminDnsStatus>("/api/v1/admin/dns/status"),

  provisionDns: (input: { apply: boolean; publicIp?: string }) =>
    request<DnsProvisionResult>("/api/v1/admin/dns/provision-base", {
      method: "POST",
      body: JSON.stringify(input),
    }),
};
