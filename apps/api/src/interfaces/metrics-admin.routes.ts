import { Router } from "express";
import { providerMetrics } from "@sitedock/shared";
import { requireSession } from "../middleware/require-session";
import { requirePlatformAdmin } from "../middleware/require-platform-admin";

/**
 * Phase 19 §17 — JSON snapshot of provider metrics (in-process
 * counters). PLATFORM_ADMIN only. An external collector can scrape
 * this or replace it with Prometheus/OTel without touching the adapters.
 */
export const metricsAdminRouter = Router();
metricsAdminRouter.use(requireSession, requirePlatformAdmin);

metricsAdminRouter.get("/metrics", (_req, res) => {
  res.json({
    generatedAt: new Date().toISOString(),
    note: "In-process counters since the last start — per instance",
    providers: providerMetrics.snapshot(),
  });
});
