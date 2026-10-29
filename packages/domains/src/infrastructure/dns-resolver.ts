/**
 * DNS-over-HTTPS resolver used for ownership and routing verification.
 *
 * Using DoH instead of the host resolver makes production behaviour
 * deterministic (the API container's resolver is not authoritative and may be
 * poisoned/limited), testable (injectable fetch) and independent of DNSHE: a
 * customer may host DNS anywhere (Cloudflare, Route53, their registrar).
 */

export type DnsQueryType = "TXT" | "A" | "AAAA" | "CNAME";

export interface DnsResolver {
  lookupTxt(name: string): Promise<string[]>;
  lookupAliases(name: string): Promise<{ type: DnsQueryType; value: string }[]>;
  lookupAddresses(name: string): Promise<string[]>;
}

export class DnsLookupError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = "DnsLookupError";
  }
}

interface DohAnswer {
  name: string;
  type: number;
  TTL?: number;
  data: string;
}

interface DohResponse {
  Status: number;
  Answer?: DohAnswer[];
}

const TYPE_BY_CODE: Record<number, DnsQueryType> = {
  1: "A",
  5: "CNAME",
  16: "TXT",
  28: "AAAA",
};

const CODE_BY_TYPE: Record<DnsQueryType, number> = {
  A: 1,
  CNAME: 5,
  TXT: 16,
  AAAA: 28,
};

/** TXT answers can be split into multiple quoted strings; join them. */
export function parseTxtAnswer(data: string): string {
  const matches = [...data.matchAll(/"((?:[^"\\]|\\.)*)"/g)];
  if (matches.length === 0) return data.replace(/^"|"$/g, "");
  return matches.map((m) => (m[1] ?? "").replace(/\\"/g, '"').replace(/\\\\/g, "\\")).join("");
}

export class DohDnsResolver implements DnsResolver {
  private readonly endpoints: string[];
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: {
    endpoints?: string[];
    timeoutMs?: number;
    fetchImpl?: typeof fetch;
  } = {}) {
    this.endpoints = options.endpoints ?? [
      process.env.DNS_OVER_HTTPS_URL?.trim() || "https://cloudflare-dns.com/dns-query",
      "https://dns.google/resolve",
    ];
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
  }

  async lookupTxt(name: string): Promise<string[]> {
    const answers = await this.query(name, "TXT");
    return answers.filter((a) => a.type === 16).map((a) => parseTxtAnswer(a.data));
  }

  async lookupAddresses(name: string): Promise<string[]> {
    const answers = await this.query(name, "A");
    return answers.filter((a) => a.type === 1).map((a) => a.data);
  }

  async lookupAliases(name: string): Promise<{ type: DnsQueryType; value: string }[]> {
    const answers = await this.query(name, "CNAME");
    return answers
      .filter((a) => a.type === 5 || a.type === 1)
      .map((a) => ({
        type: TYPE_BY_CODE[a.type] ?? "CNAME",
        value: a.data.replace(/\.$/, ""),
      }));
  }

  private async query(name: string, type: DnsQueryType): Promise<DohAnswer[]> {
    const normalized = name.trim().toLowerCase().replace(/\.$/, "");
    if (!normalized) throw new DnsLookupError("DNS name is empty", "INVALID_DNS_NAME");

    let lastError: Error | null = null;
    for (const endpoint of this.endpoints) {
      try {
        return await this.queryEndpoint(endpoint, normalized, type);
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
      }
    }
    throw new DnsLookupError(
      `DNS lookup for ${normalized} ${type} failed: ${lastError?.message ?? "unknown error"}`,
      "DNS_LOOKUP_FAILED"
    );
  }

  private async queryEndpoint(endpoint: string, name: string, type: DnsQueryType): Promise<DohAnswer[]> {
    const url = new URL(endpoint);
    url.searchParams.set("name", name);
    url.searchParams.set("type", String(CODE_BY_TYPE[type]));

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(url.toString(), {
        headers: { accept: "application/dns-json" },
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new DnsLookupError(
          `DoH endpoint returned HTTP ${response.status}`,
          "DOH_HTTP_ERROR"
        );
      }
      const body = (await response.json()) as DohResponse;
      if (body.Status === 3) return []; // NXDOMAIN is a valid negative answer
      if (body.Status !== 0) {
        throw new DnsLookupError(`DoH resolver returned status ${body.Status}`, "DOH_LOOKUP_ERROR");
      }
      return Array.isArray(body.Answer) ? body.Answer : [];
    } catch (err) {
      if (err instanceof DnsLookupError) throw err;
      if (err instanceof Error && err.name === "AbortError") {
        throw new DnsLookupError("DoH lookup timed out", "DOH_TIMEOUT");
      }
      throw new DnsLookupError(
        err instanceof Error ? err.message : "DoH lookup failed",
        "DOH_NETWORK_ERROR"
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}
