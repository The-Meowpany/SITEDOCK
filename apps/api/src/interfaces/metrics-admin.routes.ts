import { Router } from "express";
import { providerMetrics } from "@sitedock/shared";
import { requireSession } from "../middleware/require-session";
import { requirePlatformAdmin } from "../middleware/require-platform-admin";

/**
 * Fase 19 §17 — snapshot JSON de métricas de providers (contadores en
 * proceso). PLATFORM_ADMIN únicamente. Un colector externo puede scrapear
 * esto o sustituirlo por Prometheus/OTel sin tocar los adapters.
 */
export const metricsAdminRouter = Router();
metricsAdminRouter.use(requireSession, requirePlatformAdmin);

metricsAdminRouter.get("/metrics", (_req, res) => {
  res.json({
    generatedAt: new Date().toISOString(),
    note: "Contadores en proceso desde el último arranque — por instancia",
    providers: providerMetrics.snapshot(),
  });
});
