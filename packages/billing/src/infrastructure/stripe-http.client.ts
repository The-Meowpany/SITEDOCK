/**
 * Cliente HTTP mínimo para la API REST de Stripe (ADR-006).
 *
 * Decisión consciente: NO dependemos del SDK oficial todavía. La superficie
 * que Fase 16 usa es chica (accounts, account_links, checkout sessions,
 * refunds, balance_transactions) y un wrapper tipado sobre fetch:
 * - se testea offline con `fetchImpl` inyectado;
 * - evita una dependencia pesada hasta que el volumen de endpoints lo justifique.
 * Si la superficie crece, se reemplaza por el SDK sin tocar puertos ni dominio.
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

export interface StripeHttpClientOptions {
  secretKey: string;
  apiBase?: string; // default: https://api.stripe.com — override para tests/sandbox proxies
  fetchImpl?: typeof fetch; // inyectable para tests offline
}

/** Aplana objetos anidados a notación de corchetes de Stripe: price_data[currency]=usd */
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

    if (!res.ok) {
      throw new StripeApiError(
        res.status,
        json?.error?.code ?? null,
        json?.error?.message ?? `Stripe request failed with status ${res.status}`
      );
    }

    return json as T;
  }

  post<T>(path: string, params?: Record<string, unknown>, headers?: Record<string, string>) {
    return this.request<T>("POST", path, params, headers);
  }

  get<T>(path: string, query?: Record<string, unknown>, headers?: Record<string, string>) {
    return this.request<T>("GET", path, query, headers);
  }
}
