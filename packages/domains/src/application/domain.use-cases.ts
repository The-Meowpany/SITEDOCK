import { randomUUID } from "node:crypto";
import { ApplicationError, ConflictError, NotFoundError, WebsiteId } from "@sitedock/shared";
import { CustomDomain } from "../domain/custom-domain.entity";
import {
  CustomDomainRepository,
  DomainDnsInstructions,
  DomainProvider,
  ManagedDomainProvider,
  isManagedDomainProvider,
} from "../domain/ports";

export interface RegisterCustomDomainResult {
  domainId: string;
  hostname: string;
  status: CustomDomain["status"];
  provider: string;
  recordName: string;
  recordValue: string;
  routing: DomainDnsInstructions | null;
  autoManaged: boolean;
}

/**
 * Registers a domain and starts verification. When the provider manages the
 * hostname's DNS zone and the caller explicitly asks for it, SiteDock creates
 * the ownership TXT record itself; otherwise the user gets exact instructions.
 */
export class RegisterCustomDomainUseCase {
  constructor(
    private readonly domains: CustomDomainRepository,
    private readonly provider: DomainProvider
  ) {}

  async execute(command: {
    websiteId: string;
    hostname: string;
    serviceId?: string | null;
    autoManage?: boolean;
  }): Promise<RegisterCustomDomainResult> {
    const hostname = command.hostname.trim().toLowerCase().replace(/\.$/, "");
    const existing = await this.domains.findByHostname(hostname);
    if (existing) {
      throw new ConflictError(`Domain "${hostname}" is already registered on this platform`);
    }

    const domain = CustomDomain.register({
      id: randomUUID(),
      websiteId: WebsiteId(command.websiteId),
      hostname,
      serviceId: command.serviceId ?? null,
      provider: this.provider.name ?? "manual",
    });
    const proof = await this.provider.generateOwnershipProof(domain.hostname.value);
    domain.startVerification(proof.proofToken);
    domain.recordDnsInstructions("TXT", proof.recordName, proof.recordValue);

    let autoManaged = false;
    if (command.autoManage && isManagedDomainProvider(this.provider)) {
      autoManaged = await this.tryProvisionOwnershipRecord(this.provider, domain);
    }

    await this.domains.save(domain);

    const routing =
      isManagedDomainProvider(this.provider)
        ? await this.tryRoutingInstructions(this.provider, hostname)
        : null;

    return {
      domainId: domain.id,
      hostname,
      status: domain.status,
      provider: domain.provider,
      recordName: domain.dnsRecordName ?? proof.recordName,
      recordValue: domain.dnsRecordValue ?? proof.recordValue,
      routing,
      autoManaged,
    };
  }

  private async tryProvisionOwnershipRecord(
    provider: ManagedDomainProvider,
    domain: CustomDomain
  ): Promise<boolean> {
    if (!domain.ownershipProofToken) return false;
    try {
      if (!(await provider.canManage(domain.hostname.value))) return false;
      const managed = await provider.provisionOwnershipRecord(
        domain.hostname.value,
        domain.ownershipProofToken
      );
      domain.recordDnsInstructions("TXT", managed.recordName, managed.recordValue);
      domain.markAutoManaged(managed.providerRecordId);
      return true;
    } catch (err) {
      // A conflicting record or a DNSHE outage must not lose the domain:
      // fall back to manual instructions and surface the reason.
      domain.recordCheckResult({
        error: err instanceof Error ? err.message : "Could not create the DNS record automatically",
      });
      return false;
    }
  }

  private async tryRoutingInstructions(
    provider: ManagedDomainProvider,
    hostname: string
  ): Promise<DomainDnsInstructions | null> {
    try {
      return await provider.routingInstructions(hostname);
    } catch {
      return null;
    }
  }
}

async function loadOrThrow(domains: CustomDomainRepository, id: string, websiteId: string) {
  const domain = await domains.findByIdForWebsite(id, WebsiteId(websiteId));
  if (!domain) throw new NotFoundError("Domain", id);
  return domain;
}

export interface VerifyCustomDomainResult {
  verified: boolean;
  routingOk: boolean;
  sslStatus: CustomDomain["sslStatus"];
  sslExpiresAt: Date | null;
  message: string | null;
}

/**
 * Ownership comes first; routing is reported but does not block VERIFIED
 * because a customer may fix DNS minutes after publishing the TXT record.
 * TLS is probed only after verification and its failure is surfaced, never
 * swallowed.
 */
export class VerifyCustomDomainUseCase {
  constructor(
    private readonly domains: CustomDomainRepository,
    private readonly provider: DomainProvider
  ) {}

  async execute(domainId: string, websiteId: string): Promise<VerifyCustomDomainResult> {
    const domain = await loadOrThrow(this.domains, domainId, websiteId);
    if (!domain.ownershipProofToken) {
      throw new ApplicationError("Domain verification was never started", "VERIFICATION_NOT_STARTED");
    }

    if (isManagedDomainProvider(this.provider)) {
      const routing = await this.provider.checkRouting(domain.hostname.value);
      domain.recordRoutingCheck(routing.ok, routing.observed);
    }

    const confirmed = await this.provider.checkOwnershipProof(
      domain.hostname.value,
      domain.ownershipProofToken
    );

    if (!confirmed) {
      domain.markVerificationFailed(
        "Ownership TXT record was not found yet. DNS changes can take a few minutes to propagate."
      );
      await this.domains.save(domain);
      return {
        verified: false,
        routingOk: domain.routingOk,
        sslStatus: domain.sslStatus,
        sslExpiresAt: domain.sslExpiresAt,
        message: domain.lastError,
      };
    }

    domain.confirmVerified();
    await this.issueSsl(this.provider, domain);
    await this.domains.save(domain);

    return {
      verified: true,
      routingOk: domain.routingOk,
      sslStatus: domain.sslStatus,
      sslExpiresAt: domain.sslExpiresAt,
      message: domain.sslError ?? domain.lastError,
    };
  }

  private async issueSsl(provider: DomainProvider, domain: CustomDomain): Promise<void> {
    domain.markSslPending();
    try {
      const certificate = await provider.issueCertificate(domain.hostname.value);
      domain.issueSsl(certificate.expiresAt);
    } catch (err) {
      domain.markSslFailed(
        err instanceof Error
          ? err.message
          : "The certificate is not available yet. Caddy will keep trying in the background."
      );
    }
  }
}

/**
 * Re-checks a domain that is already VERIFIED. Used by the dashboard's
 * "comprobar ahora" action and by the scheduled SSL renewal job.
 */
export class CheckCustomDomainUseCase {
  constructor(
    private readonly domains: CustomDomainRepository,
    private readonly provider: DomainProvider
  ) {}

  async execute(domainId: string, websiteId: string): Promise<VerifyCustomDomainResult> {
    const domain = await loadOrThrow(this.domains, domainId, websiteId);
    if (domain.status !== "VERIFIED") {
      return new VerifyCustomDomainUseCase(this.domains, this.provider).execute(domainId, websiteId);
    }

    if (isManagedDomainProvider(this.provider)) {
      const routing = await this.provider.checkRouting(domain.hostname.value);
      domain.recordRoutingCheck(routing.ok, routing.observed);
    }

    domain.markSslPending();
    try {
      const certificate = await this.provider.issueCertificate(domain.hostname.value);
      domain.issueSsl(certificate.expiresAt);
    } catch (err) {
      domain.markSslFailed(
        err instanceof Error ? err.message : "Certificate probe failed"
      );
    }

    await this.domains.save(domain);
    return {
      verified: true,
      routingOk: domain.routingOk,
      sslStatus: domain.sslStatus,
      sslExpiresAt: domain.sslExpiresAt,
      message: domain.sslError ?? domain.lastError,
    };
  }
}

export class ListDomainsUseCase {
  constructor(
    private readonly domains: CustomDomainRepository,
    private readonly provider?: DomainProvider
  ) {}

  async execute(websiteId: string) {
    const list = await this.domains.listByWebsite(WebsiteId(websiteId));
    const managed = this.provider && isManagedDomainProvider(this.provider) ? this.provider : null;

    return Promise.all(
      list.map(async (d) => {
        let routing: DomainDnsInstructions | null = null;
        if (managed) {
          try {
            routing = await managed.routingInstructions(d.hostname.value);
          } catch {
            routing = null;
          }
        }
        return {
          id: d.id,
          hostname: d.hostname.value,
          status: d.status,
          serviceId: d.serviceId,
          verifiedAt: d.verifiedAt,
          sslIssuedAt: d.sslIssuedAt,
          sslExpiresAt: d.sslExpiresAt,
          sslStatus: d.sslStatus,
          sslError: d.sslError,
          routingOk: d.routingOk,
          routingCheckedAt: d.routingCheckedAt,
          routingObserved: d.routingObserved,
          lastError: d.lastError,
          provider: d.provider,
          autoManaged: d.autoManaged,
          dnsRecord: {
            type: d.dnsRecordType,
            name: d.dnsRecordName,
            value: d.dnsRecordValue,
          },
          instructions: routing,
        };
      })
    );
  }
}

export class DeleteCustomDomainUseCase {
  constructor(
    private readonly domains: CustomDomainRepository,
    private readonly provider: DomainProvider
  ) {}

  async execute(domainId: string, websiteId: string): Promise<{ providerRecordRemoved: boolean }> {
    const domain = await loadOrThrow(this.domains, domainId, websiteId);

    let providerRecordRemoved = false;
    if (domain.autoManaged && isManagedDomainProvider(this.provider)) {
      try {
        providerRecordRemoved = await this.provider.removeOwnershipRecord(domain);
      } catch {
        providerRecordRemoved = false;
      }
    }

    if (this.domains.deleteByIdForWebsite) {
      await this.domains.deleteByIdForWebsite(domain.id, WebsiteId(websiteId));
    }

    return { providerRecordRemoved };
  }
}
