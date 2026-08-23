import { describe, expect, it, vi } from "vitest";
import { WebsiteId } from "@sitedock/shared";
import { CustomDomain } from "../domain/custom-domain.entity";
import { CustomDomainRepository, DomainProvider, ExpiringSslDomainSnapshot } from "../domain/ports";
import { RenewExpiringCertificatesUseCase } from "../application/renew-expiring-certificates.use-case";

const WORKSPACE = "11111111-1111-1111-1111-111111111111";
const WEBSITE = "22222222-2222-2222-2222-222222222222";

function verifiedDomain(params: {
  id: string;
  hostname: string;
  sslExpiresAt: Date | null;
}): CustomDomain {
  const domain = CustomDomain.register({ id: params.id, websiteId: WebsiteId(WEBSITE), hostname: params.hostname });
  domain.startVerification("proof-token");
  domain.confirmVerified();
  if (params.sslExpiresAt) domain.issueSsl(params.sslExpiresAt);
  return domain;
}

/** Fake whose expiry query derives from stored entities — mirrors the Prisma impl's semantics. */
class InMemoryDomainRepository implements CustomDomainRepository {
  store = new Map<string, CustomDomain>();
  savedIds: string[] = [];

  async findByIdForWebsite(id: string) {
    return this.store.get(id) ?? null;
  }
  async findByHostname(hostname: string) {
    return [...this.store.values()].find((d) => d.hostname.value === hostname) ?? null;
  }
  async listByWebsite() {
    return [...this.store.values()];
  }
  async listSslExpiringBefore(deadline: Date): Promise<ExpiringSslDomainSnapshot[]> {
    return [...this.store.values()]
      .filter((d) => d.status === "VERIFIED" && d.sslExpiresAt !== null && d.sslExpiresAt <= deadline)
      .map((d) => ({
        domainId: d.id,
        hostname: d.hostname.value,
        websiteId: d.websiteId as string,
        workspaceId: WORKSPACE,
        sslExpiresAt: d.sslExpiresAt!,
      }));
  }
  async save(domain: CustomDomain) {
    this.store.set(domain.id, domain);
    this.savedIds.push(domain.id);
  }
}

/** Deterministic provider: every issuance lasts exactly 90 days from now. */
class DeterministicCertProvider implements DomainProvider {
  issuedFor: string[] = [];
  async generateOwnershipProof(hostname: string) {
    return { proofToken: "tok", recordName: `_sitedock-verify.${hostname}`, recordValue: "v" };
  }
  async checkOwnershipProof() {
    return true;
  }
  async issueCertificate(hostname: string) {
    this.issuedFor.push(hostname);
    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt.getTime() + 90 * 24 * 60 * 60 * 1000);
    return { issuedAt, expiresAt };
  }
}

describe("RenewExpiringCertificatesUseCase", () => {
  it("renews certificates inside the window and pushes them out of it (idempotent)", async () => {
    const NOW = new Date("2026-08-22T00:00:00Z");
    const domains = new InMemoryDomainRepository();
    const provider = new DeterministicCertProvider();

    const expiringSoon = verifiedDomain({
      id: "dom-soon",
      hostname: "expiring.com",
      sslExpiresAt: new Date(NOW.getTime() + 10 * 24 * 60 * 60 * 1000), // 10 days out
    });
    domains.store.set(expiringSoon.id, expiringSoon);

    const useCase = new RenewExpiringCertificatesUseCase(domains, provider);

    // First run: renews and saves.
    const renewed = await useCase.execute({ now: NOW, windowDays: 30 });
    expect(renewed).toHaveLength(1);
    expect(renewed[0]!.hostname).toBe("expiring.com");
    expect(domains.savedIds).toEqual(["dom-soon"]);

    // The stored entity now expires ~90 days out — outside the window.
    const stored = await domains.findByIdForWebsite("dom-soon");
    expect(stored!.sslExpiresAt!.getTime()).toBeGreaterThan(NOW.getTime() + 80 * 24 * 60 * 60 * 1000);

    // Second run finds nothing — no duplicate renewals.
    const secondRun = await useCase.execute({ now: NOW, windowDays: 30 });
    expect(secondRun).toHaveLength(0);
  });

  it("never issues certificates for domains that are not VERIFIED", async () => {
    const NOW = new Date("2026-08-22T00:00:00Z");
    const domains = new InMemoryDomainRepository();
    const provider = new DeterministicCertProvider();

    const pending = CustomDomain.register({
      id: "dom-pending",
      websiteId: WebsiteId(WEBSITE),
      hostname: "pending.com",
    }); // never verified → sslExpiresAt null → never matches
    domains.store.set(pending.id, pending);

    const useCase = new RenewExpiringCertificatesUseCase(domains, provider);
    const renewed = await useCase.execute({ now: NOW });

    expect(renewed).toHaveLength(0);
    expect(provider.issuedFor).toHaveLength(0);
  });

  it("throws NotFoundError when a snapshot references a deleted domain", async () => {
    const NOW = new Date("2026-08-22T00:00:00Z");
    const domains = new InMemoryDomainRepository();
    const provider = new DeterministicCertProvider();

    vi.spyOn(domains, "findByIdForWebsite").mockResolvedValue(null);
    domains.listSslExpiringBefore = async () => [
      {
        domainId: "ghost",
        hostname: "ghost.com",
        websiteId: WEBSITE,
        workspaceId: WORKSPACE,
        sslExpiresAt: new Date(NOW.getTime() + 5 * 24 * 60 * 60 * 1000),
      },
    ];

    const useCase = new RenewExpiringCertificatesUseCase(domains, provider);
    await expect(useCase.execute({ now: NOW })).rejects.toThrow(/not found/i);
  });
});
