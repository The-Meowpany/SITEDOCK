import { randomBytes } from "node:crypto";
import { ApplicationError, InfrastructureError } from "@sitedock/shared";
import { CustomDomain } from "../domain/custom-domain.entity";
import {
  DnsheClient,
  DnsheDnsRecord,
  DnsheSubdomain,
} from "./dnshe.client";
import { DnsResolver, DohDnsResolver } from "./dns-resolver";
import { CertificateProbe, NodeTlsCertificateProbe } from "./tls-probe";
import {
  DomainDnsInstructions,
  DomainProvider,
  DomainRoutingCheck,
  ManagedDomainProvider,
  ManagedOwnershipRecord,
} from "../domain/ports";

export interface DnsheDomainProviderOptions {
  client: DnsheClient;
  baseDomain: string;
  publicIp?: string | null;
  resolver?: DnsResolver;
  certificateProbe?: CertificateProbe;
  /** Edge hostname customers CNAME to (defaults to `edge.<baseDomain>`). */
  edgeHostname?: string;
  /** Cache lifetime for the account's subdomain list. */
  subdomainCacheTtlMs?: number;
}

interface ZoneCache {
  expiresAt: number;
  zones: DnsheSubdomain[];
}

function normalizeHost(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/\.$/, "");
}

function isApex(hostname: string): boolean {
  return normalizeHost(hostname).split(".").length === 2;
}

function relativeName(hostname: string, zone: DnsheSubdomain): string {
  const host = normalizeHost(hostname);
  const apex = normalizeHost(zone.full_domain);
  if (host === apex) return "@";
  if (host.endsWith(`.${apex}`)) {
    return host.slice(0, -(apex.length + 1));
  }
  throw new ApplicationError(
    `Hostname ${hostname} is not inside DNSHE zone ${zone.full_domain}`,
    "HOSTNAME_OUTSIDE_DNSHE_ZONE"
  );
}

/**
 * Production DomainProvider backed by DNSHE for the platform's own base
 * domain and by DNS-over-HTTPS for ownership/routing verification of any
 * customer domain. TLS is issued by Caddy on demand; this provider only
 * verifies the certificate Caddy actually served.
 *
 * Safety rules:
 * - Reads are always allowed.
 * - Writes only create records that do not exist yet; an existing record with
 *   a different value is a conflict, never silently overwritten.
 * - Only records created by SiteDock are deleted; customer records are never
 *   touched.
 */
export class DnsheDomainProvider implements DomainProvider, ManagedDomainProvider {
  readonly name = "dnshe";

  private readonly client: DnsheClient;
  private readonly baseDomain: string;
  private readonly publicIp: string | null;
  private readonly resolver: DnsResolver;
  private readonly certificateProbe: CertificateProbe;
  private readonly edgeHostname: string;
  private readonly subdomainCacheTtlMs: number;
  private zoneCache: ZoneCache | null = null;

  constructor(options: DnsheDomainProviderOptions) {
    this.client = options.client;
    this.baseDomain = normalizeHost(options.baseDomain);
    this.publicIp = options.publicIp?.trim() || null;
    this.resolver = options.resolver ?? new DohDnsResolver();
    this.certificateProbe = options.certificateProbe ?? new NodeTlsCertificateProbe();
    this.edgeHostname = normalizeHost(options.edgeHostname ?? `edge.${this.baseDomain}`);
    this.subdomainCacheTtlMs = options.subdomainCacheTtlMs ?? 60_000;
  }

  async generateOwnershipProof(hostname: string): Promise<{
    proofToken: string;
    recordName: string;
    recordValue: string;
  }> {
    const host = normalizeHost(hostname);
    const proofToken = randomBytes(24).toString("hex");
    return {
      proofToken,
      recordName: `_sitedock-verify.${host}`,
      recordValue: `sitedock-verification=${proofToken}`,
    };
  }

  async checkOwnershipProof(hostname: string, proofToken: string): Promise<boolean> {
    const host = normalizeHost(hostname);
    try {
      const txt = await this.resolver.lookupTxt(`_sitedock-verify.${host}`);
      return txt.some((value) => {
        const normalized = value.trim();
        return (
          normalized === `sitedock-verification=${proofToken}` ||
          normalized === proofToken
        );
      });
    } catch {
      // A DNS outage is not proof of ownership; fail closed.
      return false;
    }
  }

  async issueCertificate(hostname: string): Promise<{ issuedAt: Date; expiresAt: Date }> {
    const certificate = await this.certificateProbe.probe(normalizeHost(hostname));
    return { issuedAt: certificate.issuedAt, expiresAt: certificate.expiresAt };
  }

  async routingInstructions(hostname: string): Promise<DomainDnsInstructions> {
    const host = normalizeHost(hostname);
    const isPlatformHostname = host === this.baseDomain || host.endsWith(`.${this.baseDomain}`);

    if (isPlatformHostname) {
      if (!this.publicIp) {
        throw new InfrastructureError(
          "SITEDOCK_PUBLIC_IP is required to describe platform DNS records",
          "PUBLIC_IP_NOT_CONFIGURED"
        );
      }
      return {
        recordType: "A",
        recordName: host,
        recordValue: this.publicIp,
        ttl: 600,
      };
    }

    // Apex CNAMEs are not universally supported; prefer an A record when the
    // edge IP is known, otherwise instruct the customer to CNAME a subdomain.
    if (isApex(host) && this.publicIp) {
      return {
        recordType: "A",
        recordName: host,
        recordValue: this.publicIp,
        ttl: 600,
      };
    }

    return {
      recordType: "CNAME",
      recordName: host,
      recordValue: this.edgeHostname,
      ttl: 600,
    };
  }

  async checkRouting(hostname: string): Promise<DomainRoutingCheck> {
    const host = normalizeHost(hostname);
    const instructions = await this.routingInstructions(host);
    const observed: string[] = [];

    try {
      const aliases = await this.resolver.lookupAliases(host);
      for (const alias of aliases) {
        observed.push(`${alias.type} ${alias.value.replace(/\.$/, "")}`);
      }

      if (instructions.recordType === "CNAME") {
        const cnameOk = aliases.some(
          (a) =>
            a.type === "CNAME" &&
            a.value.toLowerCase().replace(/\.$/, "") === instructions.recordValue.toLowerCase()
        );
        if (cnameOk) {
          return {
            ok: true,
            expected: [`CNAME ${instructions.recordValue}`],
            observed,
            message: "Traffic record points at the SiteDock edge",
          };
        }
      }

      const addresses = await this.resolver.lookupAddresses(host);
      for (const address of addresses) observed.push(`A ${address}`);
      if (this.publicIp && addresses.includes(this.publicIp)) {
        return {
          ok: true,
          expected: [`A ${this.publicIp}`],
          observed,
          message: "Traffic record points at the SiteDock edge",
        };
      }

      return {
        ok: false,
        expected: [`${instructions.recordType} ${instructions.recordValue}`],
        observed,
        message:
          observed.length === 0
            ? "No A/CNAME record resolves for this hostname yet"
            : `Observed DNS does not point at the SiteDock edge (${observed.join(", ")})`,
      };
    } catch (err) {
      return {
        ok: false,
        expected: [`${instructions.recordType} ${instructions.recordValue}`],
        observed,
        message: err instanceof Error ? err.message : "DNS lookup failed",
      };
    }
  }

  async canManage(hostname: string): Promise<boolean> {
    try {
      return (await this.findZone(hostname)) !== null;
    } catch {
      return false;
    }
  }

  async provisionOwnershipRecord(hostname: string, proofToken: string): Promise<ManagedOwnershipRecord> {
    const host = normalizeHost(hostname);
    const zone = await this.requireZone(host);
    const recordName = relativeName(`_sitedock-verify.${host}`, zone);
    const recordValue = `sitedock-verification=${proofToken}`;
    const existing = await this.findRecord(zone.id, "TXT", recordName);

    if (existing) {
      const content = existing.content.replace(/^"|"$/g, "");
      if (content !== recordValue) {
        throw new ApplicationError(
          `A TXT record already exists at ${recordName} with a different value; refusing to overwrite it`,
          "DNS_RECORD_CONFLICT"
        );
      }
      return {
        providerRecordId: `${zone.id}:${existing.id}`,
        recordName: `${recordName === "@" ? zone.full_domain : `${recordName}.${zone.full_domain}`}`,
        recordValue,
      };
    }

    const created = await this.client.createRecord(zone.id, {
      type: "TXT",
      name: recordName,
      content: recordValue,
      ttl: 600,
    });

    return {
      providerRecordId: `${zone.id}:${created.id}`,
      recordName: `${recordName === "@" ? zone.full_domain : `${recordName}.${zone.full_domain}`}`,
      recordValue,
    };
  }

  async removeOwnershipRecord(domain: CustomDomain): Promise<boolean> {
    if (!domain.providerRecordId) return false;
    const [zoneIdRaw, recordId] = domain.providerRecordId.split(":");
    const zoneId = Number(zoneIdRaw);
    if (!Number.isInteger(zoneId) || !recordId) return false;

    try {
      const records = await this.client.listRecords(zoneId);
      const record = records.find(
        (r) => String(r.id) === recordId || r.record_id === recordId
      );
      if (!record) return false;
      // Only delete a record that still has the value SiteDock created.
      const expected = domain.dnsRecordValue ?? "";
      const actual = record.content.replace(/^"|"$/g, "");
      if (expected && actual !== expected) return false;
      await this.client.deleteRecord(
        String(record.id) === recordId ? { id: record.id } : { record_id: recordId }
      );
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Plans or applies the platform wildcard/apex A records. Dry-run is the
   * default at the route layer. Existing records are never overwritten: a
   * conflicting value is reported and left untouched.
   */
  async provisionPlatformAddressRecords(
    publicIp: string,
    apply: boolean
  ): Promise<{
    changed: boolean;
    applied: boolean;
    zone: string;
    records: Array<{ name: string; type: string; value: string; action: "create" | "exists" | "conflict" }>;
  }> {
    const ip = publicIp.trim();
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip) || ip.split(".").some((part) => Number(part) > 255)) {
      throw new ApplicationError("A valid IPv4 address is required", "INVALID_PUBLIC_IP");
    }

    const zone = await this.requireZone(this.baseDomain);
    const existing = await this.client.listRecords(zone.id);
    const results: Array<{ name: string; type: string; value: string; action: "create" | "exists" | "conflict" }> = [];

    for (const name of ["@", "*"]) {
      const record = existing.find(
        (r) => r.type.toUpperCase() === "A" && r.name.toLowerCase().replace(/\.$/, "") === name
      );
      if (!record) {
        results.push({ name, type: "A", value: ip, action: "create" });
        if (apply) {
          await this.client.createRecord(zone.id, { type: "A", name, content: ip, ttl: 600 });
        }
        continue;
      }

      const matches = record.content.trim() === ip;
      results.push({
        name,
        type: "A",
        value: matches ? ip : record.content,
        action: matches ? "exists" : "conflict",
      });
    }

    const creations = results.filter((r) => r.action === "create").length;
    return {
      changed: creations > 0,
      applied: apply && creations > 0,
      zone: zone.full_domain,
      records: results,
    };
  }
  /** Read-only account inventory for the admin status endpoint. */
  async describeAccount(): Promise<{
    baseDomain: string;
    zone: DnsheSubdomain | null;
    zoneCount: number;
    records: DnsheDnsRecord[];
  }> {
    const subdomains = await this.client.listSubdomains({ per_page: 500 });
    const zones = subdomains.subdomains ?? [];
    const zone = await this.findZoneIn(zones, this.baseDomain);
    const records = zone ? await this.client.listRecords(zone.id) : [];
    return {
      baseDomain: this.baseDomain,
      zone,
      zoneCount: zones.length,
      records,
    };
  }

  private async findZone(hostname: string): Promise<DnsheSubdomain | null> {
    const zones = await this.listZones();
    return this.findZoneIn(zones, hostname);
  }

  private async requireZone(hostname: string): Promise<DnsheSubdomain> {
    const zone = await this.findZone(hostname);
    if (!zone) {
      throw new ApplicationError(
        `DNSHE does not manage ${hostname}. Add the domain to the DNSHE account or create the DNS records manually.`,
        "DNSHE_ZONE_NOT_FOUND"
      );
    }
    return zone;
  }

  private findZoneIn(zones: DnsheSubdomain[], hostname: string): DnsheSubdomain | null {
    const host = normalizeHost(hostname);
    return (
      zones
        .filter((zone) => {
          const apex = normalizeHost(zone.full_domain);
          return host === apex || host.endsWith(`.${apex}`);
        })
        .sort((a, b) => b.full_domain.length - a.full_domain.length)[0] ?? null
    );
  }

  private async listZones(): Promise<DnsheSubdomain[]> {
    const now = Date.now();
    if (this.zoneCache && this.zoneCache.expiresAt > now) return this.zoneCache.zones;

    const result = await this.client.listSubdomains({ per_page: 500 });
    const zones = result.subdomains ?? [];
    this.zoneCache = { zones, expiresAt: now + this.subdomainCacheTtlMs };
    return zones;
  }

  private async findRecord(
    zoneId: number,
    type: string,
    relative: string
  ): Promise<DnsheDnsRecord | null> {
    const records = await this.client.listRecords(zoneId);
    return (
      records.find(
        (record) =>
          record.type.toUpperCase() === type.toUpperCase() &&
          record.name.toLowerCase().replace(/\.$/, "") === relative.toLowerCase().replace(/\.$/, "")
      ) ?? null
    );
  }
}

export function createDnsheDomainProviderFromEnv(
  env: NodeJS.ProcessEnv = process.env
): DnsheDomainProvider | null {
  const apiKey = env.DNSHE_API_KEY?.trim();
  const apiSecret = env.DNSHE_API_SECRET?.trim();
  if (!apiKey || !apiSecret) return null;

  const client = new DnsheClient({
    apiKey,
    apiSecret,
    baseUrl: env.DNSHE_API_BASE_URL?.trim() || undefined,
  });
  return new DnsheDomainProvider({
    client,
    baseDomain: env.SITEDOCK_BASE_DOMAIN?.trim() || "sitedock.us.ci",
    publicIp: env.SITEDOCK_PUBLIC_IP?.trim() || null,
    edgeHostname: env.SITEDOCK_EDGE_HOSTNAME?.trim() || undefined,
  });
}
