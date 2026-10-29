import { describe, expect, it } from "vitest";
import { ApplicationError } from "@sitedock/shared";
import {
  DnsheClient,
  DnsheDnsRecord,
  DnsheListResponse,
  DnsheSubdomain,
} from "../infrastructure/dnshe.client";
import { DnsheDomainProvider } from "../infrastructure/dnshe-domain.provider";
import { DnsResolver, DnsQueryType } from "../infrastructure/dns-resolver";
import { CertificateProbe } from "../infrastructure/tls-probe";

const ZONE: DnsheSubdomain = {
  id: 42,
  subdomain: "sitedock",
  rootdomain: "us.ci",
  full_domain: "sitedock.us.ci",
  status: "active",
};

class StubClient {
  records: DnsheDnsRecord[] = [];
  created: Array<Record<string, unknown>> = [];
  deleted: Array<Record<string, unknown>> = [];

  async listSubdomains(): Promise<DnsheListResponse<DnsheSubdomain>> {
    return { success: true, count: 1, subdomains: [ZONE] };
  }
  async listRecords(): Promise<DnsheDnsRecord[]> {
    return this.records;
  }
  async createRecord(_zoneId: number, input: Record<string, unknown>) {
    this.created.push(input);
    return { id: 100 + this.created.length, recordId: `rec-${this.created.length}` };
  }
  async deleteRecord(record: Record<string, unknown>) {
    this.deleted.push(record);
  }
}

class FakeResolver implements DnsResolver {
  txt: string[] = [];
  aliases: { type: DnsQueryType; value: string }[] = [];
  addresses: string[] = [];

  async lookupTxt() { return this.txt; }
  async lookupAliases() { return this.aliases; }
  async lookupAddresses() { return this.addresses; }
}

class FakeProbe implements CertificateProbe {
  async probe() {
    return {
      issuedAt: new Date("2026-01-01T00:00:00Z"),
      expiresAt: new Date("2026-04-01T00:00:00Z"),
      issuer: "Test CA",
      subject: "example.com",
      authorized: true,
    };
  }
}

function providerWith(client: StubClient, options: { publicIp?: string | null } = {}) {
  const resolver = new FakeResolver();
  const provider = new DnsheDomainProvider({
    client: client as unknown as DnsheClient,
    baseDomain: "sitedock.us.ci",
    publicIp: options.publicIp === undefined ? "203.0.113.10" : options.publicIp,
    resolver,
    certificateProbe: new FakeProbe(),
  });
  return { provider, resolver };
}

describe("DnsheClient", () => {
  it("sends credentials only as headers and never in the URL", async () => {
    let capturedUrl = "";
    let capturedHeaders: Record<string, string> = {};
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      capturedUrl = String(url);
      capturedHeaders = (init?.headers ?? {}) as Record<string, string>;
      return new Response(JSON.stringify({ success: true, count: 0, subdomains: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    const client = new DnsheClient({
      apiKey: "key_123",
      apiSecret: "secret_456",
      fetchImpl,
    });

    await client.healthCheck();

    expect(capturedHeaders["x-api-key"]).toBe("key_123");
    expect(capturedHeaders["x-api-secret"]).toBe("secret_456");
    expect(capturedUrl).not.toContain("key_123");
    expect(capturedUrl).not.toContain("secret_456");
    expect(capturedUrl).toContain("endpoint=subdomains");
    expect(capturedUrl).toContain("action=list");
  });

  it("refuses to construct without credentials", () => {
    expect(() => new DnsheClient({ apiKey: "", apiSecret: "" })).toThrow(/required/);
  });

  it("maps API errors without leaking the secret", async () => {
    const client = new DnsheClient({
      apiKey: "key_123",
      apiSecret: "secret_456",
      fetchImpl: (async () =>
        new Response(JSON.stringify({ success: false, message: "Invalid API key" }), {
          status: 401,
        })) as typeof fetch,
    });

    await expect(client.healthCheck()).rejects.toMatchObject({
      name: "DnsheApiError",
      statusCode: 401,
      message: "Invalid API key",
    });
  });
});

describe("DnsheDomainProvider", () => {
  it("verifies only the exact ownership TXT value", async () => {
    const { provider, resolver } = providerWith(new StubClient());

    resolver.txt = ["sitedock-verification=abc123"];
    await expect(provider.checkOwnershipProof("example.com", "abc123")).resolves.toBe(true);

    resolver.txt = ["sitedock-verification=other"];
    await expect(provider.checkOwnershipProof("example.com", "abc123")).resolves.toBe(false);

    resolver.txt = [];
    await expect(provider.checkOwnershipProof("example.com", "abc123")).resolves.toBe(false);
  });

  it("fails closed when DNS lookups fail", async () => {
    const { provider, resolver } = providerWith(new StubClient());
    resolver.lookupTxt = async () => {
      throw new Error("resolver down");
    };
    await expect(provider.checkOwnershipProof("example.com", "abc123")).resolves.toBe(false);
  });

  it("uses a CNAME for subdomains and verifies the observed target", async () => {
    const { provider, resolver } = providerWith(new StubClient(), { publicIp: null });
    const instructions = await provider.routingInstructions("www.example.com");
    expect(instructions).toEqual({
      recordType: "CNAME",
      recordName: "www.example.com",
      recordValue: "edge.sitedock.us.ci",
      ttl: 600,
    });

    resolver.aliases = [{ type: "CNAME", value: "edge.sitedock.us.ci." }];
    const check = await provider.checkRouting("www.example.com");
    expect(check.ok).toBe(true);
    expect(check.observed).toContain("CNAME edge.sitedock.us.ci");
  });

  it("uses an A record for apex domains when the edge IP is known", async () => {
    const { provider, resolver } = providerWith(new StubClient());
    const instructions = await provider.routingInstructions("cliente.com");
    expect(instructions.recordType).toBe("A");
    expect(instructions.recordValue).toBe("203.0.113.10");

    resolver.addresses = ["203.0.113.10"];
    await expect(provider.checkRouting("cliente.com")).resolves.toMatchObject({ ok: true });
  });

  it("never overwrites a conflicting ownership TXT record", async () => {
    const client = new StubClient();
    client.records = [
      {
        id: 7,
        record_id: "rec-7",
        name: "_sitedock-verify",
        type: "TXT",
        content: "someone-elses-value",
        ttl: 600,
      },
    ];
    const { provider } = providerWith(client);

    await expect(provider.provisionOwnershipRecord("sitedock.us.ci", "abc123")).rejects.toBeInstanceOf(
      ApplicationError
    );
    expect(client.created).toHaveLength(0);
  });

  it("creates the ownership TXT only when absent and records its provider id", async () => {
    const client = new StubClient();
    const { provider } = providerWith(client);

    const result = await provider.provisionOwnershipRecord("sitedock.us.ci", "abc123");
    expect(client.created).toEqual([
      {
        type: "TXT",
        name: "_sitedock-verify",
        content: "sitedock-verification=abc123",
        ttl: 600,
      },
    ]);
    expect(result.providerRecordId).toBe("42:101");
  });

  it("dry-runs platform A records and applies them only when asked", async () => {
    const client = new StubClient();
    const { provider } = providerWith(client);

    const dryRun = await provider.provisionPlatformAddressRecords("203.0.113.10", false);
    expect(dryRun.changed).toBe(true);
    expect(dryRun.applied).toBe(false);
    expect(client.created).toHaveLength(0);

    const applied = await provider.provisionPlatformAddressRecords("203.0.113.10", true);
    expect(applied.applied).toBe(true);
    expect(client.created).toEqual([
      { type: "A", name: "@", content: "203.0.113.10", ttl: 600 },
      { type: "A", name: "*", content: "203.0.113.10", ttl: 600 },
    ]);
  });

  it("reports an existing wildcard A record with a different IP as a conflict", async () => {
    const client = new StubClient();
    client.records = [
      { id: 1, name: "*", type: "A", content: "198.51.100.1", ttl: 600 },
      { id: 2, name: "@", type: "A", content: "203.0.113.10", ttl: 600 },
    ];
    const { provider } = providerWith(client);

    const result = await provider.provisionPlatformAddressRecords("203.0.113.10", true);
    expect(result.changed).toBe(false);
    expect(result.applied).toBe(false);
    expect(result.records).toEqual([
      { name: "@", type: "A", value: "203.0.113.10", action: "exists" },
      { name: "*", type: "A", value: "198.51.100.1", action: "conflict" },
    ]);
    expect(client.created).toHaveLength(0);
  });
});
