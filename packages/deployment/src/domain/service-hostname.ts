import { DomainError } from "@sitedock/shared";

const HOSTNAME_LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * Service hostnames are globally unique DNS labels below the platform base
 * domain (e.g. `reference-app.sitedock.local`). They are the authoritative
 * tenant routing key, so they must be valid labels and can never contain a dot,
 * slash, whitespace, uppercase characters or a leading/trailing hyphen.
 */
export function normalizeServiceHostname(value: string): string {
  const hostname = value.trim().toLowerCase();
  if (hostname.length === 0 || hostname.length > 63 || !HOSTNAME_LABEL.test(hostname)) {
    throw new DomainError(
      `Invalid service hostname '${value}': expected a lowercase DNS label (a-z, 0-9, hyphen)`,
      "INVALID_HOSTNAME"
    );
  }
  return hostname;
}

export function defaultServiceHostname(name: string, serviceId: string): string {
  const slug = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "service";
  return normalizeServiceHostname(`${slug}-${serviceId.slice(0, 8)}`);
}
