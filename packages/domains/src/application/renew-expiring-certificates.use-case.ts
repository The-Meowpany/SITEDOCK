import { NotFoundError, WebsiteId } from "@sitedock/shared";
import { CustomDomainRepository, DomainProvider } from "../domain/ports";

export interface SslRenewalResult {
  domainId: string;
  hostname: string;
  renewedUntil: Date;
}

/**
 * Scheduled-job use case (docs/ARCHITECTURE.md §31 / brief §17 "SSL próximo a
 * vencer → renovar automáticamente"). Finds VERIFIED domains whose SSL
 * certificate expires inside the window and re-issues through the
 * DomainProvider — the same port used for the first issuance, so a real DNS/
 * ACME provider slots in without touching this code.
 *
 * Idempotent by construction: each renewal pushes sslExpiresAt beyond the
 * window (providers issue certificates with ~1 year validity), so the domain
 * stops matching `listSslExpiringBefore` on the next run. Re-running after a
 * partial failure only retries the domains that didn't get saved.
 */
export class RenewExpiringCertificatesUseCase {
  constructor(
    private readonly domains: CustomDomainRepository,
    private readonly provider: DomainProvider
  ) {}

  async execute(options: { now?: Date; windowDays?: number } = {}): Promise<SslRenewalResult[]> {
    const now = options.now ?? new Date();
    const windowDays = options.windowDays ?? 30;
    const deadline = new Date(now);
    deadline.setDate(deadline.getDate() + windowDays);

    const expiring = await this.domains.listSslExpiringBefore(deadline);
    const renewed: SslRenewalResult[] = [];

    for (const snapshot of expiring) {
      const certificate = await this.provider.issueCertificate(snapshot.hostname);

      const domain = await this.domains.findByIdForWebsite(snapshot.domainId, WebsiteId(snapshot.websiteId));
      if (!domain) throw new NotFoundError("Domain", snapshot.domainId);

      domain.issueSsl(certificate.expiresAt);
      await this.domains.save(domain);

      renewed.push({
        domainId: snapshot.domainId,
        hostname: snapshot.hostname,
        renewedUntil: certificate.expiresAt,
      });
    }

    return renewed;
  }
}
