import { DomainError, DomainName, WebsiteId } from "@sitedock/shared";
import { DomainVerificationStatus, domainStateMachine } from "./domain-status";

export type SslStatus = "NONE" | "PENDING" | "ISSUED" | "FAILED";

export interface CustomDomainProps {
  id: string;
  websiteId: WebsiteId;
  serviceId: string | null;
  hostname: DomainName;
  status: DomainVerificationStatus;
  provider: string;
  ownershipProofToken: string | null;
  providerRecordId: string | null;
  dnsRecordType: string | null;
  dnsRecordName: string | null;
  dnsRecordValue: string | null;
  autoManaged: boolean;
  routingOk: boolean;
  routingCheckedAt: Date | null;
  routingObserved: string[];
  lastError: string | null;
  verificationAttempts: number;
  sslStatus: SslStatus;
  sslError: string | null;
  verifiedAt: Date | null;
  sslIssuedAt: Date | null;
  sslExpiresAt: Date | null;
  createdAt: Date;
}

/**
 * CustomDomain aggregate — protects the invariant that VERIFIED can only be
 * reached after a real ownership proof has been generated and confirmed via
 * the DomainProvider (docs/ARCHITECTURE.md §5). Routing and TLS are tracked
 * separately so a DNS-verified domain with a broken CNAME or a pending Caddy
 * certificate is never reported as fully healthy.
 */
export class CustomDomain {
  private constructor(private props: CustomDomainProps) {}

  static register(params: {
    id: string;
    websiteId: WebsiteId;
    hostname: string;
    serviceId?: string | null;
    provider?: string;
  }): CustomDomain {
    return new CustomDomain({
      id: params.id,
      websiteId: params.websiteId,
      serviceId: params.serviceId ?? null,
      hostname: DomainName.create(params.hostname),
      status: "PENDING",
      provider: params.provider ?? "manual",
      ownershipProofToken: null,
      providerRecordId: null,
      dnsRecordType: null,
      dnsRecordName: null,
      dnsRecordValue: null,
      autoManaged: false,
      routingOk: false,
      routingCheckedAt: null,
      routingObserved: [],
      lastError: null,
      verificationAttempts: 0,
      sslStatus: "NONE",
      sslError: null,
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
    this.props.lastError = null;
    if (this.props.status !== "VERIFYING") {
      this.transitionTo("VERIFYING");
    }
  }

  /** Records the exact DNS instruction the user has to publish (or that we created). */
  recordDnsInstructions(type: string, name: string, value: string): void {
    this.props.dnsRecordType = type;
    this.props.dnsRecordName = name;
    this.props.dnsRecordValue = value;
  }

  markAutoManaged(providerRecordId: string | null): void {
    this.props.autoManaged = true;
    this.props.providerRecordId = providerRecordId;
  }

  recordRoutingCheck(ok: boolean, observed: string[], checkedAt = new Date()): void {
    this.props.routingOk = ok;
    this.props.routingObserved = observed.slice(0, 20);
    this.props.routingCheckedAt = checkedAt;
  }

  recordCheckResult(params: { at?: Date; error?: string | null } = {}): void {
    this.props.lastError = params.error ?? null;
  }

  /** Only callable once the DomainProvider has confirmed the ownership proof is actually present. */
  confirmVerified(): void {
    if (!this.props.ownershipProofToken) {
      throw new DomainError("Cannot verify a domain that never received an ownership proof token", "MISSING_OWNERSHIP_PROOF");
    }
    if (this.props.status !== "VERIFIED") {
      this.transitionTo("VERIFIED");
    }
    this.props.verifiedAt = this.props.verifiedAt ?? new Date();
    this.props.lastError = null;
    this.props.verificationAttempts += 1;
  }

  markVerificationFailed(message?: string): void {
    if (this.props.status === "VERIFIED") {
      this.props.lastError = message ?? "Re-verification failed";
      this.props.verificationAttempts += 1;
      return;
    }
    this.props.lastError = message ?? null;
    this.props.verificationAttempts += 1;
    if (this.props.status === "VERIFYING") {
      this.transitionTo("FAILED");
    }
  }

  /**
   * SSL can only be issued for a domain whose ownership has actually been
   * verified. The expiry comes from the certificate Caddy served — it is what
   * the scheduled renewal job watches (brief §17 "SSL próximo a vencer").
   */
  issueSsl(sslExpiresAt?: Date): void {
    if (this.props.status !== "VERIFIED") {
      throw new DomainError("Cannot issue SSL for a domain that is not VERIFIED", "DOMAIN_NOT_VERIFIED");
    }
    this.props.sslIssuedAt = new Date();
    this.props.sslExpiresAt = sslExpiresAt ?? null;
    this.props.sslStatus = "ISSUED";
    this.props.sslError = null;
  }

  markSslFailed(message: string): void {
    this.props.sslStatus = "FAILED";
    this.props.sslError = message.slice(0, 1000);
  }

  markSslPending(): void {
    if (this.props.sslStatus !== "ISSUED") {
      this.props.sslStatus = "PENDING";
    }
  }

  get id() { return this.props.id; }
  get websiteId() { return this.props.websiteId; }
  get serviceId() { return this.props.serviceId; }
  get hostname() { return this.props.hostname; }
  get status() { return this.props.status; }
  get provider() { return this.props.provider; }
  get ownershipProofToken() { return this.props.ownershipProofToken; }
  get providerRecordId() { return this.props.providerRecordId; }
  get dnsRecordType() { return this.props.dnsRecordType; }
  get dnsRecordName() { return this.props.dnsRecordName; }
  get dnsRecordValue() { return this.props.dnsRecordValue; }
  get autoManaged() { return this.props.autoManaged; }
  get routingOk() { return this.props.routingOk; }
  get routingCheckedAt() { return this.props.routingCheckedAt; }
  get routingObserved() { return this.props.routingObserved; }
  get lastError() { return this.props.lastError; }
  get verificationAttempts() { return this.props.verificationAttempts; }
  get sslStatus() { return this.props.sslStatus; }
  get sslError() { return this.props.sslError; }
  get verifiedAt() { return this.props.verifiedAt; }
  get sslIssuedAt() { return this.props.sslIssuedAt; }
  get sslExpiresAt() { return this.props.sslExpiresAt; }
  get createdAt() { return this.props.createdAt; }
}
