import { WebsiteId } from "@sitedock/shared";
import { CustomDomain } from "./custom-domain.entity";

export interface CustomDomainRepository {
  findByIdForWebsite(id: string, websiteId: WebsiteId): Promise<CustomDomain | null>;
  findByHostname(hostname: string): Promise<CustomDomain | null>;
  listByWebsite(websiteId: WebsiteId): Promise<CustomDomain[]>;
  /**
   * System-level scheduled-job query (docs/ARCHITECTURE.md §31): VERIFIED
   * domains whose SSL certificate expires before `deadline`, joined with the
   * owning workspace so the caller can reach the right people.
   */
  listSslExpiringBefore(deadline: Date): Promise<ExpiringSslDomainSnapshot[]>;
  deleteByIdForWebsite?(id: string, websiteId: WebsiteId): Promise<void>;
  save(domain: CustomDomain): Promise<void>;
}

/** Row shape for the SSL-renewal job: the domain plus its tenant boundary. */
export interface ExpiringSslDomainSnapshot {
  domainId: string;
  hostname: string;
  websiteId: string;
  workspaceId: string;
  sslExpiresAt: Date;
}

export interface DomainRoutingCheck {
  ok: boolean;
  expected: string[];
  observed: string[];
  message: string;
}

export interface DomainDnsInstructions {
  recordType: "TXT" | "CNAME" | "A";
  recordName: string;
  recordValue: string;
  ttl: number;
}

export interface ManagedOwnershipRecord {
  providerRecordId: string;
  recordName: string;
  recordValue: string;
}

/**
 * DomainProvider abstraction (docs/ARCHITECTURE.md §10 "Domain Management").
 * SiteDock never builds its own registrar — this port is implemented by a
 * MockDomainProvider for demo/MVP and by DnsheDomainProvider in production
 * without touching the application layer.
 */
export interface DomainProvider {
  readonly name?: string;

  /** Generates the ownership-proof value the user must publish (e.g. as a DNS TXT record). */
  generateOwnershipProof(hostname: string): Promise<{ proofToken: string; recordName: string; recordValue: string }>;

  /** Checks whether the proof is actually present in DNS right now. */
  checkOwnershipProof(hostname: string, proofToken: string): Promise<boolean>;

  /** Issues/renews an SSL certificate for a verified domain. */
  issueCertificate(hostname: string): Promise<{ issuedAt: Date; expiresAt: Date }>;
}

/**
 * Optional capabilities for providers that can also manage DNS and verify
 * routing. The dashboard uses them when present; otherwise it shows manual
 * instructions. Keeping them optional preserves the mock provider contract.
 */
export interface ManagedDomainProvider extends DomainProvider {
  /** Where users should point the domain's traffic record. */
  routingInstructions(hostname: string): Promise<DomainDnsInstructions>;

  /** Verifies the traffic record actually resolves to SiteDock's edge. */
  checkRouting(hostname: string): Promise<DomainRoutingCheck>;

  /** Creates the ownership TXT record when the zone is managed by the provider. */
  provisionOwnershipRecord(hostname: string, proofToken: string): Promise<ManagedOwnershipRecord>;

  /** Removes a record previously created by provisionOwnershipRecord, if it still exists. */
  removeOwnershipRecord(domain: CustomDomain): Promise<boolean>;

  /** True when the provider can manage records for this hostname's zone. */
  canManage(hostname: string): Promise<boolean>;
}

export function isManagedDomainProvider(provider: DomainProvider): provider is ManagedDomainProvider {
  const candidate = provider as Partial<ManagedDomainProvider>;
  return (
    typeof candidate.routingInstructions === "function" &&
    typeof candidate.checkRouting === "function" &&
    typeof candidate.provisionOwnershipRecord === "function" &&
    typeof candidate.removeOwnershipRecord === "function" &&
    typeof candidate.canManage === "function"
  );
}
