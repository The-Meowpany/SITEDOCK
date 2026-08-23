import { DomainError } from "./errors";

/** Branded id helper — prevents passing a WebsiteId where a ClientId is expected. */
export type Brand<T, B extends string> = T & { readonly __brand: B };

export type UserId = Brand<string, "UserId">;
export type WorkspaceId = Brand<string, "WorkspaceId">;
export type ClientId = Brand<string, "ClientId">;
export type WebsiteId = Brand<string, "WebsiteId">;
export type DeploymentId = Brand<string, "DeploymentId">;
export type SubscriptionId = Brand<string, "SubscriptionId">;
export type ServicePlanId = Brand<string, "ServicePlanId">;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function brandUuid<B extends string>(value: string, brand: B): Brand<string, B> {
  if (!UUID_RE.test(value)) {
    throw new DomainError(`Invalid ${brand}: "${value}" is not a UUID`, "INVALID_ID");
  }
  return value as Brand<string, B>;
}

export const UserId = (v: string): UserId => brandUuid(v, "UserId");
export const WorkspaceId = (v: string): WorkspaceId => brandUuid(v, "WorkspaceId");
export const ClientId = (v: string): ClientId => brandUuid(v, "ClientId");
export const WebsiteId = (v: string): WebsiteId => brandUuid(v, "WebsiteId");
export const DeploymentId = (v: string): DeploymentId => brandUuid(v, "DeploymentId");
export const SubscriptionId = (v: string): SubscriptionId => brandUuid(v, "SubscriptionId");
export const ServicePlanId = (v: string): ServicePlanId => brandUuid(v, "ServicePlanId");

/** EmailAddress value object — validated once at the boundary, safe everywhere after. */
export class EmailAddress {
  private static readonly EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  readonly value: string;

  private constructor(value: string) {
    this.value = value;
  }

  static create(raw: string): EmailAddress {
    const normalized = raw.trim().toLowerCase();
    if (!EmailAddress.EMAIL_RE.test(normalized)) {
      throw new DomainError(`Invalid email address: "${raw}"`, "INVALID_EMAIL");
    }
    return new EmailAddress(normalized);
  }

  equals(other: EmailAddress): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}

/**
 * DomainName value object — validates hostnames used for custom domains and
 * generated subdomains (docs/ARCHITECTURE.md "Value Objects" list).
 */
export class DomainName {
  private static readonly HOSTNAME_RE =
    /^(?=.{1,253}$)(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/;
  readonly value: string;

  private constructor(value: string) {
    this.value = value;
  }

  static create(raw: string): DomainName {
    const normalized = raw.trim().toLowerCase();
    if (!DomainName.HOSTNAME_RE.test(normalized)) {
      throw new DomainError(`Invalid domain name: "${raw}"`, "INVALID_DOMAIN_NAME");
    }
    return new DomainName(normalized);
  }

  equals(other: DomainName): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}

/** Money value object. Amount is stored in integer minor units (cents) to avoid
 * floating point error. Never construct Money from a raw float.
 */
export class Money {
  private constructor(
    readonly amountCents: number,
    readonly currency: string
  ) {}

  static fromCents(amountCents: number, currency: string): Money {
    if (!Number.isInteger(amountCents)) {
      throw new DomainError("Money amount must be an integer number of minor units", "INVALID_MONEY");
    }
    if (amountCents < 0) {
      throw new DomainError("Money amount cannot be negative", "INVALID_MONEY");
    }
    return new Money(amountCents, currency.toUpperCase());
  }

  static fromDecimalString(amount: string, currency: string): Money {
    // Parses "29.99" safely without floating point: split on the decimal point.
    const [whole, fraction = "0"] = amount.split(".");
    const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0").slice(0, 2));
    return Money.fromCents(cents, currency);
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return Money.fromCents(this.amountCents + other.amountCents, this.currency);
  }

  percentage(pct: number): Money {
    return Money.fromCents(Math.round((this.amountCents * pct) / 100), this.currency);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return Money.fromCents(this.amountCents - other.amountCents, this.currency);
  }

  private assertSameCurrency(other: Money) {
    if (this.currency !== other.currency) {
      throw new DomainError(
        `Cannot operate on Money with different currencies: ${this.currency} vs ${other.currency}`,
        "CURRENCY_MISMATCH"
      );
    }
  }

  toDecimalString(): string {
    return (this.amountCents / 100).toFixed(2);
  }
}
