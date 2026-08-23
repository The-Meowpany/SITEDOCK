import express from "express";
import helmet from "helmet";
import cors from "cors";
import type { Request, Response, NextFunction } from "express";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import { randomUUID } from "node:crypto";
import { config } from "./config";
import { logger } from "./logger";
import { apiRateLimiter } from "./middleware/rate-limit";
import { errorHandler, notFoundHandler } from "./middleware/error-handler";
import { authRouter } from "./interfaces/auth.routes";
import { workspaceRouter, invitationRouter } from "./interfaces/workspace.routes";
import { clientRouter } from "./interfaces/client.routes";
import { projectRouter, websiteRouter } from "./interfaces/website.routes";
import { deploymentRouter } from "./interfaces/deployment.routes";
import { backupsRouter } from "./interfaces/backups.routes";
import { chargesRouter } from "./interfaces/charges.routes";
import { publicDemoRouter } from "./interfaces/public-demo.routes";
import {
  merchantRouter,
  refundsRouter,
  reconciliationRouter,
} from "./interfaces/merchant.routes";
import { metricsAdminRouter } from "./interfaces/metrics-admin.routes";
import { servicePlanRouter, subscriptionRouter, demoPaymentRouter, paymentWebhookRouter } from "./interfaces/billing.routes";
import { maintenanceRouter } from "./interfaces/maintenance.routes";
import { domainsRouter } from "./interfaces/domains.routes";
import { auditRouter } from "./interfaces/audit.routes";
import { dashboardRouter } from "./interfaces/dashboard.routes";
import { adminRouter } from "./interfaces/admin.routes";

export function createApp() {
  const app = express();

  /** Correlation id for every request — used by pino-http and error responses. */
  function assignRequestId(req: Request, _res: Response, next: NextFunction) {
    req.requestId = randomUUID();
    next();
  }

  app.disable("x-powered-by");
  app.use(helmet());
  app.use(cors({ origin: config.corsOrigin, credentials: true }));

  // IMPORTANT: the payment webhook route needs the exact raw bytes the
  // provider signed, so it must be mounted with express.raw() BEFORE the
  // global express.json() parser below — once JSON has re-serialized the
  // body, signature verification would never match (docs/ARCHITECTURE.md §76).
  app.use(
    "/api/v1/webhooks/payments",
    express.raw({ type: "*/*", limit: "1mb" }),
    assignRequestId,
    apiRateLimiter,
    paymentWebhookRouter
  );

  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());
  app.use(assignRequestId);
  app.use(pinoHttp({ logger, genReqId: (req) => req.requestId ?? randomUUID() }));

  // Liveness must never depend on the database (docs/ARCHITECTURE.md §health checks).
  app.get("/health/live", (_req, res) => res.status(200).json({ status: "ok" }));
  app.get("/health/ready", async (_req, res) => {
    try {
      const { prisma } = await import("@sitedock/database");
      await prisma.$queryRaw`SELECT 1`;
      res.status(200).json({ status: "ok" });
    } catch {
      res.status(503).json({ status: "unavailable" });
    }
  });

  app.use("/api/v1/public", publicDemoRouter);
  app.use("/api/v1", apiRateLimiter);
  app.use("/api/v1/auth", authRouter);
  app.use("/api/v1/workspaces", workspaceRouter);
  app.use("/api/v1/invitations", invitationRouter);
  app.use("/api/v1/workspaces/:workspaceId/clients", clientRouter);
  app.use("/api/v1/workspaces/:workspaceId/projects", projectRouter);
  app.use("/api/v1/workspaces/:workspaceId/websites", websiteRouter);
  app.use("/api/v1/workspaces/:workspaceId/websites/:websiteId/deployments", deploymentRouter);
  app.use("/api/v1/workspaces/:workspaceId/websites/:websiteId/backups", backupsRouter);
  app.use("/api/v1/workspaces/:workspaceId/websites/:websiteId/charges", chargesRouter);
  app.use("/api/v1/workspaces/:workspaceId/websites/:websiteId/maintenance-requests", maintenanceRouter);
  app.use("/api/v1/workspaces/:workspaceId/websites/:websiteId/domains", domainsRouter);
  app.use("/api/v1/workspaces/:workspaceId/plans", servicePlanRouter);
  app.use("/api/v1/workspaces/:workspaceId/websites/:websiteId/subscription", subscriptionRouter);
  if (config.allowDemoEndpoints) {
    app.use("/api/v1/workspaces/:workspaceId/demo-payments", demoPaymentRouter);
  }
  app.use("/api/v1/workspaces/:workspaceId/audit-logs", auditRouter);
  app.use("/api/v1/workspaces/:workspaceId/dashboard", dashboardRouter);
  app.use("/api/v1/workspaces/:workspaceId/merchant", merchantRouter);
  app.use("/api/v1/workspaces/:workspaceId/payments", refundsRouter);
  app.use("/api/v1/admin/reconciliation", reconciliationRouter);
  app.use("/api/v1/admin/metrics", metricsAdminRouter);
  app.use("/api/v1/admin", adminRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
