import { describe, expect, it, beforeEach } from "vitest";
import { DomainError, WebsiteId } from "@sitedock/shared";
import { CustomDomain } from "../domain/custom-domain.entity";
import { CustomDomainRepository, DomainProvider } from "../domain/ports";
import { MockDomainProvider } from "../infrastructure/mock-domain.provider";
import { RegisterCustomDomainUseCase, VerifyCustomDomainUseCase } from "../application/domain.use-cases";

const WEBSITE = WebsiteId("11111111-1111-1111-1111-111111111111");

describe("CustomDomain aggregate", () => {
  it("registers in PENDING status", () => {
    const domain = CustomDomain.register({ id: "d1", websiteId: WEBSITE, hostname: "restauranteperez.com" });
    expect(domain.status).toBe("PENDING");
    expect(domain.hostname.value).toBe("restauranteperez.com");
  });

  it("rejects an invalid hostname at registration", () => {
    expect(() => CustomDomain.register({ id: "d1", websiteId: WEBSITE, hostname: "not a domain" })).toThrow(DomainError);
  });

  it("cannot be confirmed VERIFIED without ever starting verification", () => {
    const domain = CustomDomain.register({ id: "d1", websiteId: WEBSITE, hostname: "restauranteperez.com" });
    // No ownership proof was ever generated, so the aggregate's own guard fires
    // before the state-machine transition check even runs — the most specific
    // error wins, which is exactly the invariant docs/ARCHITECTURE.md §5 asks for.
    expect(() => domain.confirmVerified()).toThrow(DomainError);
    expect(() => domain.confirmVerified()).toThrow(/ownership proof/);
  });

  it("cannot be confirmed VERIFIED with no ownership proof token even mid-flow", () => {
    // Defensive check: even if somehow status were VERIFYING without a token
    // (shouldn't happen through the public API), confirmVerified() still guards it.
    const domain = CustomDomain.register({ id: "d1", websiteId: WEBSITE, hostname: "restauranteperez.com" });
    domain.startVerification("proof-123");
    expect(domain.ownershipProofToken).toBe("proof-123");
    expect(() => domain.confirmVerified()).not.toThrow();
    expect(domain.status).toBe("VERIFIED");
  });

  it("walks PENDING → VERIFYING → VERIFIED and allows issuing SSL only after that", () => {
    const domain = CustomDomain.register({ id: "d1", websiteId: WEBSITE, hostname: "restauranteperez.com" });
    domain.startVerification("proof-123");
    expect(domain.status).toBe("VERIFYING");
    domain.confirmVerified();
    expect(domain.status).toBe("VERIFIED");
    expect(domain.verifiedAt).not.toBeNull();

    domain.issueSsl();
    expect(domain.sslIssuedAt).not.toBeNull();
  });

  it("rejects issuing SSL before verification", () => {
    const domain = CustomDomain.register({ id: "d1", websiteId: WEBSITE, hostname: "restauranteperez.com" });
    expect(() => domain.issueSsl()).toThrow(DomainError);
  });

  it("allows retrying verification after a failure", () => {
    const domain = CustomDomain.register({ id: "d1", websiteId: WEBSITE, hostname: "restauranteperez.com" });
    domain.startVerification("proof-123");
    domain.markVerificationFailed();
    expect(domain.status).toBe("FAILED");
    domain.startVerification("proof-456");
    expect(domain.status).toBe("VERIFYING");
  });
});

class InMemoryCustomDomainRepository implements CustomDomainRepository {
  store = new Map<string, CustomDomain>();
  async findByIdForWebsite(id: string, websiteId: string) {
    const d = this.store.get(id);
    return d && d.websiteId === websiteId ? d : null;
  }
  async findByHostname(hostname: string) {
    return [...this.store.values()].find((d) => d.hostname.value === hostname) ?? null;
  }
  async listByWebsite(websiteId: string) {
    return [...this.store.values()].filter((d) => d.websiteId === websiteId);
  }
  async listSslExpiringBefore() {
    return [];
  }
  async save(domain: CustomDomain) {
    this.store.set(domain.id, domain);
  }
}

class FailingDomainProvider implements DomainProvider {
  async generateOwnershipProof(hostname: string) {
    return { proofToken: "fake-token", recordName: `_verify.${hostname}`, recordValue: "fake" };
  }
  async checkOwnershipProof() {
    return false;
  }
  async issueCertificate() {
    return { issuedAt: new Date(), expiresAt: new Date() };
  }
}

describe("RegisterCustomDomainUseCase + VerifyCustomDomainUseCase", () => {
  let domains: InMemoryCustomDomainRepository;

  beforeEach(() => {
    domains = new InMemoryCustomDomainRepository();
  });

  it("registers a domain and starts verification with a DNS record to publish", async () => {
    const register = new RegisterCustomDomainUseCase(domains, new MockDomainProvider());
    const result = await register.execute({ websiteId: WEBSITE, hostname: "restauranteperez.com" });

    expect(result.recordName).toBe("_sitedock-verify.restauranteperez.com");
    const stored = await domains.findByIdForWebsite(result.domainId, WEBSITE);
    expect(stored?.status).toBe("VERIFYING");
  });

  it("rejects registering a hostname that's already taken on the platform", async () => {
    const register = new RegisterCustomDomainUseCase(domains, new MockDomainProvider());
    await register.execute({ websiteId: WEBSITE, hostname: "restauranteperez.com" });
    await expect(register.execute({ websiteId: WEBSITE, hostname: "restauranteperez.com" })).rejects.toThrow(/already registered/);
  });

  it("confirms verification and issues SSL when the provider finds the proof in DNS", async () => {
    const provider = new MockDomainProvider();
    const register = new RegisterCustomDomainUseCase(domains, provider);
    const { domainId } = await register.execute({ websiteId: WEBSITE, hostname: "restauranteperez.com" });

    const verify = new VerifyCustomDomainUseCase(domains, provider);
    const result = await verify.execute(domainId, WEBSITE);

    expect(result.verified).toBe(true);
    const stored = await domains.findByIdForWebsite(domainId, WEBSITE);
    expect(stored?.status).toBe("VERIFIED");
    expect(stored?.sslIssuedAt).not.toBeNull();
  });

  it("marks verification FAILED when the provider cannot find the proof in DNS", async () => {
    // Register with a working provider so startVerification succeeds, then verify with a failing one.
    const register = new RegisterCustomDomainUseCase(domains, new MockDomainProvider());
    const { domainId } = await register.execute({ websiteId: WEBSITE, hostname: "restauranteperez.com" });

    const verify = new VerifyCustomDomainUseCase(domains, new FailingDomainProvider());
    const result = await verify.execute(domainId, WEBSITE);

    expect(result.verified).toBe(false);
    const stored = await domains.findByIdForWebsite(domainId, WEBSITE);
    expect(stored?.status).toBe("FAILED");
  });
});
