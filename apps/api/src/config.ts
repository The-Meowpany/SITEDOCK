/** Typed configuration. Business logic never reads process.env directly. */
export const config = {
  env: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 4000),
  cookieDomain: process.env.COOKIE_DOMAIN,
  isProduction: process.env.NODE_ENV === "production",
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:3000",
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
};
