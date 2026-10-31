import { withProviderMetrics } from "@sitedock/shared";

/**
 * Minimal HTTP client for the Stripe REST API (ADR-006).
 *
 * Conscious decision: we do NOT depend on the official SDK yet. The surface
 * that Phase 16 uses is small (accounts, account_links, checkout sessions,
 * refunds, balance_transactions) and a typed wrapper over fetch:
 * - is tested offline with an injected `fetchImpl`;
 * - avoids a heavy dependency until the endpoint volume justifies it.
 * If the surface grows, it is replaced by the SDK without touching ports or domain.
 *
 * Phase 19 (hardening):
 * - `Idempotency-Key` supported on POST — guarantees ONE economic effect per key
 *   even if the response is lost and the client retries.
 * - 429 → StripeRateLimitError with retryAfterMs from the Retry-After header
 *   (callers must NEVER retry immediately).
 * - Per-operation metrics (outcome + latency) via @sitedock/shared.
 */

export type StripeHttpMethod = "GET" | "POST";

export class StripeApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string | null,
    message: string
  ) {
    super(message);
    this.name = "StripeApiError";
  }
}

/** 429 with Retry-After — callers must wait; never retry immediately. */
export class StripeRateLimitError extends Error {
  constructor(public readonly retryAfterMs: number | null) {
    super("Stripe rate limit exceeded");
    this.name = "StripeRateLimitError";
  }
}

export interface StripeHttpClientOptions {
  secretKey: string;
  apiBase?: string; // default: https://api.stripe.com — override para tests/sandbox proxies
  fetchImpl?: typeof fetch; // injectable for offline tests
}

export interface StripePostOptions {
  idempotencyKey?: string;
  headers?: Record<string, string>;
}

/** Flattens nested objects to Stripe's bracket notation: price_data[currency]=usd */
export function flattenStripeParams(
  params: Record<string, unknown>,
  prefix = ""
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    const path = prefix ? `${prefix}[${key}]` : key;
    if (typeof value === "object" && !Array.isArray(value)) {
      Object.assign(out, flattenStripeParams(value as Record<string, unknown>, path));
    } else if (Array.isArray(value)) {
      value.forEach((v, i) => Object.assign(out, flattenStripeParams({ [String(i)]: v }, path)));
    } else {
      out[path] = String(value);
    }
  }
  return out;
}

export class StripeHttpClient {
  private readonly base: string;
  private readonly doFetch: typeof fetch;

  constructor(private readonly options: StripeHttpClientOptions) {
    this.base = options.apiBase ?? "https://api.stripe.com";
    this.doFetch = options.fetchImpl ?? fetch;
  }

  async request<T>(
    method: StripeHttpMethod,
    path: string,
    params?: Record<string, unknown>,
    headers: Record<string, string> = {}
  ): Promise<T> {
    const operation = `${method} ${path}`;
    return withProviderMetrics({ provider: "stripe", operation }, async () => {
      const url =
        method === "GET" && params
          ? `${this.base}${path}?${new URLSearchParams(flattenStripeParams(params))}`
          : `${this.base}${path}`;

      const res = await this.doFetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${this.options.secretKey}`,
          ...(method === "POST"
            ? { "Content-Type": "application/x-www-form-urlencoded" }
            : {}),
          ...headers,
        },
        body: method === "POST" && params ? new URLSearchParams(flattenStripeParams(params)).toString() : undefined,
      });

      const json = (await res.json().catch(() => null)) as
        | T & { error?: { message?: string; code?: string } }
        | null;

      if (res.status === 429) {
        const retryAfterHeader = res.headers.get("retry-after");
        const retryAfterMs =
          retryAfterHeader && Number.isFinite(Number(retryAfterHeader))
            ? Number(retryAfterHeader) * 1000
            : null;
        throw new StripeRateLimitError(retryAfterMs);
      }

      if (!res.ok) {
        throw new StripeApiError(
          res.status,
          json?.error?.code ?? null,
          json?.error?.message ?? `Stripe request failed with status ${res.status}`
        );
      }

      return json as T;
    });
  }

  post<T>(path: string, params?: Record<string, unknown>, options?: StripePostOptions) {
    return this.request<T>("POST", path, params, {
      ...(options?.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : {}),
      ...options?.headers,
    });
  }

  get<T>(path: string, query?: Record<string, unknown>, headers?: Record<string, string>) {
    return this.request<T>("GET", path, query, headers);
  }
}

