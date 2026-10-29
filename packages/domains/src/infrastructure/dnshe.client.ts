/**
 * Minimal, dependency-free client for the DNSHE domain/DNS API (V2).
 *
 * Authentication is header-only (`X-API-Key` / `X-API-Secret`). Credentials
 * are never placed in URLs, logged, included in error messages or persisted in
 * SiteDock's database. Every write method maps 1:1 to a documented DNSHE
 * action; SiteDock only calls them after an explicit user/admin action.
 *
 * Docs: https://api005.dnshe.com/knowledgebase/13/ (Free Domain API V2.0)
 */

export interface DnsheConfig {
  apiKey: string;
  apiSecret: string;
  /** Usually `https://api005.dnshe.com/index.php`. */
  baseUrl?: string;
  timeoutMs?: number;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

export interface DnsheSubdomain {
  id: number;
  subdomain: string;
  rootdomain: string;
  full_domain: string;
  status: string;
  created_at?: string;
  updated_at?: string;
  expires_at?: string | null;
  never_expires?: boolean | number;
}

export interface DnsheDnsRecord {
  id: number | string;
  record_id?: string;
  name: string;
  type: string;
  content: string;
  ttl: number;
  priority?: number | null;
  status?: string;
  created_at?: string;
  updated_at?: string;
}

export interface DnsheListResponse<T> {
  success: true;
  count: number;
  subdomains?: T[];
  records?: T[];
  pagination?: {
    mode?: string;
    page?: number;
    per_page?: number;
    has_more?: boolean;
    cursor_id?: number;
    next_cursor_id?: number;
  };
}

export interface DnsheRecordInput {
  type: string;
  name?: string;
  content?: string;
  ttl?: number;
  priority?: number;
  [key: string]: string | number | undefined;
}

export class DnsheApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code: string
  ) {
    super(message);
    this.name = "DnsheApiError";
  }
}

const DEFAULT_BASE_URL = "https://api005.dnshe.com/index.php";
const DEFAULT_TIMEOUT_MS = 20_000;

function normalizeBaseUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
    throw new DnsheApiError("DNSHE_API_BASE_URL must use https", 0, "INSECURE_BASE_URL");
  }
  return url.toString();
}

function extractError(body: unknown, statusCode: number): { code: string; message: string } {
  if (typeof body === "object" && body !== null) {
    const obj = body as Record<string, unknown>;
    const code =
      typeof obj.error_code === "string"
        ? obj.error_code
        : typeof obj.code === "string"
          ? obj.code
          : `HTTP_${statusCode}`;
    const message =
      typeof obj.message === "string"
        ? obj.message
        : typeof obj.error === "string"
          ? obj.error
          : `DNSHE request failed with HTTP ${statusCode}`;
    return { code, message };
  }
  return { code: `HTTP_${statusCode}`, message: `DNSHE request failed with HTTP ${statusCode}` };
}

export class DnsheClient {
  private readonly apiKey: string;
  private readonly apiSecret: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(config: DnsheConfig) {
    if (!config.apiKey?.trim() || !config.apiSecret?.trim()) {
      throw new DnsheApiError(
        "DNSHE_API_KEY and DNSHE_API_SECRET are required",
        0,
        "DNSHE_NOT_CONFIGURED"
      );
    }
    this.apiKey = config.apiKey.trim();
    this.apiSecret = config.apiSecret.trim();
    this.baseUrl = normalizeBaseUrl(config.baseUrl ?? DEFAULT_BASE_URL);
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch;
  }

  /** Read-only probe used by health checks: lists at most one subdomain. */
  async healthCheck(): Promise<{ ok: true; count: number }> {
    const result = await this.listSubdomains({ per_page: 1 });
    return { ok: true, count: result.count };
  }

  async listSubdomains(params: {
    page?: number;
    per_page?: number;
    search?: string;
    rootdomain?: string;
    status?: "active" | "suspended" | "expired";
    fields?: string;
    cursor_id?: number;
    include_total?: boolean;
  } = {}): Promise<DnsheListResponse<DnsheSubdomain>> {
    const query: Record<string, string | number | boolean | undefined> = {
      page: params.page,
      per_page: params.per_page,
      search: params.search,
      rootdomain: params.rootdomain,
      status: params.status,
      fields: params.fields,
      cursor_id: params.cursor_id,
      include_total: params.include_total,
    };
    const result = await this.request<DnsheListResponse<DnsheSubdomain>>(
      "subdomains",
      "list",
      "GET",
      query
    );
    return { ...result, subdomains: result.subdomains ?? [] };
  }

  /**
   * Finds the exact registered subdomain (for example `sitedock.us.ci`) that
   * owns `fullDomain`, preferring the longest matching suffix. Read-only.
   */
  async findOwningSubdomain(fullDomain: string): Promise<DnsheSubdomain | null> {
    const hostname = fullDomain.toLowerCase().replace(/\.$/, "");
    const firstLabel = hostname.split(".")[0] ?? hostname;
    const candidates = new Map<string, DnsheSubdomain>();
    let cursorId: number | undefined;

    for (let page = 0; page < 20; page += 1) {
      const result = await this.listSubdomains({
        per_page: 500,
        search: firstLabel.slice(0, 63),
        cursor_id: cursorId,
      });
      for (const subdomain of result.subdomains ?? []) {
        candidates.set(subdomain.full_domain.toLowerCase(), subdomain);
      }
      const next = result.pagination?.next_cursor_id;
      if (!result.pagination?.has_more || next === undefined || next === cursorId) break;
      cursorId = next;
    }

    // Search is prefix-based upstream; a full listing is the authoritative
    // fallback when the searched prefix does not match the apex label.
    if (candidates.size === 0) {
      const all = await this.listSubdomains({ per_page: 500 });
      for (const subdomain of all.subdomains ?? []) {
        candidates.set(subdomain.full_domain.toLowerCase(), subdomain);
      }
    }

    const matches = [...candidates.values()]
      .filter((s) => hostname === s.full_domain.toLowerCase() || hostname.endsWith(`.${s.full_domain.toLowerCase()}`))
      .sort((a, b) => b.full_domain.length - a.full_domain.length);

    return matches[0] ?? null;
  }

  async createSubdomain(subdomain: string, domain: string): Promise<{
    subdomainId: number;
    fullDomain: string;
  }> {
    const result = await this.request<{
      success: true;
      subdomain_id: number;
      full_domain: string;
    }>("subdomains", "create", "POST", undefined, { subdomain, domain });
    return { subdomainId: result.subdomain_id, fullDomain: result.full_domain };
  }

  async listRecords(subdomainId: number): Promise<DnsheDnsRecord[]> {
    const result = await this.request<DnsheListResponse<DnsheDnsRecord>>(
      "dns_records",
      "list",
      "GET",
      { subdomain_id: subdomainId }
    );
    return result.records ?? [];
  }

  async createRecord(subdomainId: number, record: DnsheRecordInput): Promise<{
    id: number | string;
    recordId?: string;
  }> {
    const result = await this.request<{
      success: true;
      id: number | string;
      record_id?: string;
    }>("dns_records", "create", "POST", undefined, { subdomain_id: subdomainId, ...record });
    return { id: result.id, recordId: result.record_id };
  }

  async modifyRecord(record: {
    id?: number | string;
    record_id?: string;
  } & DnsheRecordInput): Promise<void> {
    await this.request("dns_records", "modify", "POST", undefined, record);
  }

  async deleteRecord(record: { id?: number | string; record_id?: string }): Promise<void> {
    await this.request("dns_records", "delete", "POST", undefined, record);
  }

  private async request<T>(
    endpoint: string,
    action: string,
    method: "GET" | "POST",
    query?: Record<string, string | number | boolean | undefined>,
    body?: Record<string, unknown>
  ): Promise<T> {
    const url = new URL(this.baseUrl);
    if (!url.searchParams.has("m")) url.searchParams.set("m", "domain_hub");
    url.searchParams.set("endpoint", endpoint);
    url.searchParams.set("action", action);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(url.toString(), {
        method,
        headers: {
          "x-api-key": this.apiKey,
          "x-api-secret": this.apiSecret,
          accept: "application/json",
          ...(body ? { "content-type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      const text = await response.text();
      let parsed: unknown = null;
      if (text.trim()) {
        try {
          parsed = JSON.parse(text) as unknown;
        } catch {
          parsed = null;
        }
      }

      const failed =
        !response.ok ||
        (typeof parsed === "object" &&
          parsed !== null &&
          (parsed as { success?: boolean }).success === false);

      if (failed) {
        const { code, message } = extractError(parsed, response.status);
        throw new DnsheApiError(message, response.status, code);
      }

      if (parsed === null) {
        throw new DnsheApiError(
          "DNSHE returned an empty or non-JSON response",
          response.status,
          "INVALID_DNSHE_RESPONSE"
        );
      }

      return parsed as T;
    } catch (err) {
      if (err instanceof DnsheApiError) throw err;
      if (err instanceof Error && err.name === "AbortError") {
        throw new DnsheApiError("DNSHE request timed out", 0, "DNSHE_TIMEOUT");
      }
      throw new DnsheApiError(
        err instanceof Error ? `DNSHE request failed: ${err.message}` : "DNSHE request failed",
        0,
        "DNSHE_NETWORK_ERROR"
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}

export interface DnsheEnv {
  apiKey: string;
  apiSecret: string;
  baseUrl: string;
  baseDomain: string;
  publicIp: string | null;
  managed: boolean;
}

/** Returns null when DNSHE is not configured; never throws for missing env in development. */
export function dnsheEnvFromProcess(env: NodeJS.ProcessEnv = process.env): DnsheEnv | null {
  const apiKey = env.DNSHE_API_KEY?.trim();
  const apiSecret = env.DNSHE_API_SECRET?.trim();
  if (!apiKey || !apiSecret) return null;
  return {
    apiKey,
    apiSecret,
    baseUrl: env.DNSHE_API_BASE_URL?.trim() || DEFAULT_BASE_URL,
    baseDomain: (env.SITEDOCK_BASE_DOMAIN?.trim() || "sitedock.us.ci").toLowerCase().replace(/\.$/, ""),
    publicIp: env.SITEDOCK_PUBLIC_IP?.trim() || null,
    managed: env.DOMAIN_PROVIDER !== "manual",
  };
}

export function createDnsheClientFromEnv(env: NodeJS.ProcessEnv = process.env): DnsheClient | null {
  const config = dnsheEnvFromProcess(env);
  if (!config) return null;
  return new DnsheClient({
    apiKey: config.apiKey,
    apiSecret: config.apiSecret,
    baseUrl: config.baseUrl,
  });
}
