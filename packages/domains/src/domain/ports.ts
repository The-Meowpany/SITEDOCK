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

/**
 * DomainProvider abstraction (docs/ARCHITECTURE.md §10 "Domain Management").
 * SiteDock never builds its own registrar — this port is implemented by a
 * MockDomainProvider for demo/MVP and swapped for a real registrar/DNS API
 * (e.g. Cloudflare, Route53) in production without touching any use case.
 */
export interface DomainProvider {
  /** Generates the ownership-proof value the user must publish (e.g. as a DNS TXT record). */
  generateOwnershipProof(hostname: string): Promise<{ proofToken: string; recordName: string; recordValue: string }>;

  /** Checks whether the proof is actually present in DNS right now. */
  checkOwnershipProof(hostname: string, proofToken: string): Promise<boolean>;

  /** Issues/renews an SSL certificate for a verified domain. */
  issueCertificate(hostname: string): Promise<{ issuedAt: Date; expiresAt: Date }>;
}
