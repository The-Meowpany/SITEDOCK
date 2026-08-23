import { DomainError, DomainName, WebsiteId } from "@sitedock/shared";
import { DomainVerificationStatus, domainStateMachine } from "./domain-status";

export interface CustomDomainProps {
  id: string;
  websiteId: WebsiteId;
  hostname: DomainName;
  status: DomainVerificationStatus;
  ownershipProofToken: string | null;
  verifiedAt: Date | null;
  sslIssuedAt: Date | null;
  sslExpiresAt: Date | null;
  createdAt: Date;
}

/**
 * CustomDomain aggregate — named CustomDomain (not just "Domain") to avoid a
 * naming collision with the branded WebsiteId-style ids and the generic
 * DomainName value object it wraps. Protects the invariant that VERIFIED can
 * only be reached after a real ownership proof has been generated and
 * confirmed via the DomainProvider (docs/ARCHITECTURE.md §5).
 */
export class CustomDomain {
  private constructor(private props: CustomDomainProps) {}

  static register(params: { id: string; websiteId: WebsiteId; hostname: string }): CustomDomain {
    return new CustomDomain({
      id: params.id,
      websiteId: params.websiteId,
      hostname: DomainName.create(params.hostname),
      status: "PENDING",
      ownershipProofToken: null,
      verifiedAt: null,
      sslIssuedAt: null,
      sslExpiresAt: null,
      createdAt: new Date(),
    });
  }

  static hydrate(props: CustomDomainProps): CustomDomain {
    return new CustomDomain(props);
  }

  private transitionTo(next: DomainVerificationStatus): void {
    domainStateMachine.assertCanTransition(this.props.status, next);
    this.props.status = next;
  }

  /** Kicks off verification with a provider-issued ownership proof token (e.g. a DNS TXT record value). */
  startVerification(proofToken: string): void {
    this.props.ownershipProofToken = proofToken;
    this.transitionTo("VERIFYING");
  }

  /** Only callable once the DomainProvider has confirmed the ownership proof is actually present. */
  confirmVerified(): void {
    if (!this.props.ownershipProofToken) {
      throw new DomainError("Cannot verify a domain that never received an ownership proof token", "MISSING_OWNERSHIP_PROOF");
    }
    this.transitionTo("VERIFIED");
    this.props.verifiedAt = new Date();
  }

  markVerificationFailed(): void {
    this.transitionTo("FAILED");
  }

  /**
   * SSL can only be issued for a domain whose ownership has actually been
   * verified. The expiry comes from the DomainProvider's certificate — it is
   * what the scheduled renewal job watches (brief §17 "SSL próximo a vencer").
   */
  issueSsl(sslExpiresAt?: Date): void {
    if (this.props.status !== "VERIFIED") {
      throw new DomainError("Cannot issue SSL for a domain that is not VERIFIED", "DOMAIN_NOT_VERIFIED");
    }
    this.props.sslIssuedAt = new Date();
    this.props.sslExpiresAt = sslExpiresAt ?? null;
  }

  get id() { return this.props.id; }
  get websiteId() { return this.props.websiteId; }
  get hostname() { return this.props.hostname; }
  get status() { return this.props.status; }
  get ownershipProofToken() { return this.props.ownershipProofToken; }
  get verifiedAt() { return this.props.verifiedAt; }
  get sslIssuedAt() { return this.props.sslIssuedAt; }
  get sslExpiresAt() { return this.props.sslExpiresAt; }
  get createdAt() { return this.props.createdAt; }
}
