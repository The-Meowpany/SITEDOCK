import { randomUUID } from "node:crypto";
import { ApplicationError, ConflictError, NotFoundError, WebsiteId } from "@sitedock/shared";
import { CustomDomain } from "../domain/custom-domain.entity";
import { CustomDomainRepository, DomainProvider } from "../domain/ports";

export class RegisterCustomDomainUseCase {
  constructor(
    private readonly domains: CustomDomainRepository,
    private readonly provider: DomainProvider
  ) {}

  async execute(command: { websiteId: string; hostname: string }): Promise<{ domainId: string; recordName: string; recordValue: string }> {
    const existing = await this.domains.findByHostname(command.hostname);
    if (existing) {
      throw new ConflictError(`Domain "${command.hostname}" is already registered on this platform`);
    }

    const domain = CustomDomain.register({ id: randomUUID(), websiteId: WebsiteId(command.websiteId), hostname: command.hostname });
    const proof = await this.provider.generateOwnershipProof(domain.hostname.value);
    domain.startVerification(proof.proofToken);

    await this.domains.save(domain);

    return { domainId: domain.id, recordName: proof.recordName, recordValue: proof.recordValue };
  }
}

async function loadOrThrow(domains: CustomDomainRepository, id: string, websiteId: string) {
  const domain = await domains.findByIdForWebsite(id, WebsiteId(websiteId));
  if (!domain) throw new NotFoundError("Domain", id);
  return domain;
}

/**
 * Polls the DomainProvider for the actual DNS state before ever marking a
 * domain VERIFIED — the aggregate itself also refuses to verify without a
 * proof token, so this is defense in depth, not the only guard.
 */
export class VerifyCustomDomainUseCase {
  constructor(
    private readonly domains: CustomDomainRepository,
    private readonly provider: DomainProvider
  ) {}

  async execute(domainId: string, websiteId: string): Promise<{ verified: boolean }> {
    const domain = await loadOrThrow(this.domains, domainId, websiteId);
    if (!domain.ownershipProofToken) {
      throw new ApplicationError("Domain verification was never started", "VERIFICATION_NOT_STARTED");
    }

    const confirmed = await this.provider.checkOwnershipProof(domain.hostname.value, domain.ownershipProofToken);

    if (confirmed) {
      domain.confirmVerified();
      domain.issueSsl();
    } else {
      domain.markVerificationFailed();
    }

    await this.domains.save(domain);
    return { verified: confirmed };
  }
}

export class ListDomainsUseCase {
  constructor(private readonly domains: CustomDomainRepository) {}

  async execute(websiteId: string) {
    const list = await this.domains.listByWebsite(WebsiteId(websiteId));
    return list.map((d) => ({
      id: d.id,
      hostname: d.hostname.value,
      status: d.status,
      verifiedAt: d.verifiedAt,
      sslIssuedAt: d.sslIssuedAt,
    }));
  }
}
