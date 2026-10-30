/**
 * Typed configuration. Business logic never reads process.env directly.
 */

/** Fase 19 §7/§8 — validación centralizada: en producción una configuración
 * de provider PEDIDA pero incompleta es un fallo de arranque, nunca un
 * fallback silencioso a mocks. Pura e inyectable → testeable. Devuelve la
 * lista de errores (vacía = OK).
 */
export function validateProductionConfig(
  env: NodeJS.ProcessEnv,
  isProduction: boolean
): string[] {
  if (!isProduction) return [];
  const errors: string[] = [];

  if (!env.DATABASE_URL) errors.push("DATABASE_URL is required in production");

  if (env.PAYMENT_PROVIDER === "stripe") {
    if (!env.STRIPE_SECRET_KEY) errors.push("PAYMENT_PROVIDER=stripe requires STRIPE_SECRET_KEY");
    if (!env.STRIPE_WEBHOOK_SECRET)
      errors.push("PAYMENT_PROVIDER=stripe requires STRIPE_WEBHOOK_SECRET");
  }

  if (env.STORAGE_PROVIDER === "s3") {
    for (const key of ["S3_BUCKET", "S3_REGION", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"] as const) {
      if (!env[key]) errors.push(`STORAGE_PROVIDER=s3 requires ${key}`);
    }
  }

  if (env.DOMAIN_PROVIDER === "dnshe") {
    if (!env.DNSHE_API_KEY || !env.DNSHE_API_SECRET) {
      errors.push("DOMAIN_PROVIDER=dnshe requires DNSHE_API_KEY and DNSHE_API_SECRET");
    }
    if (!env.SITEDOCK_BASE_DOMAIN) {
      errors.push("DOMAIN_PROVIDER=dnshe requires SITEDOCK_BASE_DOMAIN");
    }
    if (!env.SITEDOCK_PUBLIC_IP && !env.SITEDOCK_EDGE_HOSTNAME) {
      errors.push("DOMAIN_PROVIDER=dnshe requires SITEDOCK_PUBLIC_IP or SITEDOCK_EDGE_HOSTNAME");
    }
  }

  if (env.EMAIL_PROVIDER === "resend") {
    if (!env.RESEND_API_KEY) errors.push("EMAIL_PROVIDER=resend requires RESEND_API_KEY");
    if (!env.RESEND_FROM) errors.push("EMAIL_PROVIDER=resend requires RESEND_FROM");
  }

  return errors;
}

/** CORS_ORIGIN is a comma-separated list (see .env.example); cors() needs an array, not the raw string. */
export function parseCorsOrigins(value: string | undefined): string[] {
  const origins = (value ?? "http://localhost:3000").split(",").map((o) => o.trim()).filter(Boolean);
  return origins.length ? origins : ["http://localhost:3000"];
}

export const config = {
  env: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 4000),
  cookieDomain: process.env.COOKIE_DOMAIN,
  dashboardUrl: process.env.DASHBOARD_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  isProduction: process.env.NODE_ENV === "production",
  corsOrigin: parseCorsOrigins(process.env.CORS_ORIGIN),
  /**
   * Demo-only mutation endpoints (/demo-payments/* simulate payment outcomes
   * and force suspensions). NEVER available in production — they exist so the
   * full checkout→payment→suspension flow can be exercised without a real
   * provider (docs/ARCHITECTURE.md §45).
   */
  allowDemoEndpoints:
    process.env.NODE_ENV !== "production" && process.env.DEMO_MODE !== "false",
  /** Platform revenue-share percentage applied to every successful payment (brief §8). */
  platformFeePercentage: Number(process.env.PLATFORM_FEE_PERCENTAGE ?? 10),

  validateProductionConfig,
};
