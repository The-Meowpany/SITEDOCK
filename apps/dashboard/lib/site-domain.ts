const DEFAULT_SITE_DOMAIN = "sitedock.app";

export function siteDomain(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_DOMAIN ??
    process.env.NEXT_PUBLIC_BASE_DOMAIN ??
    DEFAULT_SITE_DOMAIN
  );
}

export function siteHostname(subdomain: string): string {
  return `${subdomain}.${siteDomain()}`;
}
