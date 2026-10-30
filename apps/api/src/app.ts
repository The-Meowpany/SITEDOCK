import express from "express";
import helmet from "helmet";
import cors from "cors";
import type { Request, Response, NextFunction } from "express";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import crypto from "node:crypto";
import { randomUUID } from "node:crypto";
import { config } from "./config";
import { logger } from "./logger";
import { apiRateLimiter } from "./middleware/rate-limit";
import { errorHandler, notFoundHandler } from "./middleware/error-handler";
import { authRouter } from "./interfaces/auth.routes";
import { hostRoutingMiddleware } from "./middleware/host-routing";
import { tlsAskRouter } from "./interfaces/tls-ask.routes";
import { createPublicSitesRouter } from "./interfaces/public-sites.routes";
import { PrismaWebsiteRepository } from "@sitedock/website";
import { storage } from "./storage";
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
import { adminDnsRouter } from "./interfaces/admin-dns.routes";
import { githubConnectionsRouter } from "./interfaces/github-connections.routes";
import { dashboardRouter } from "./interfaces/dashboard.routes";
import { adminRouter } from "./interfaces/admin.routes";
import { serviceRouter } from "./interfaces/service.routes";
import { environmentRouter } from "./interfaces/environment.routes";
import { githubRouter } from "@sitedock/github";
import { requireSession } from "./middleware/require-session";
import { apiTokensRouter } from "./interfaces/api-tokens.routes";
import { authenticateApiToken, apiTokenPathGuard, apiTokenScopeGuard } from "./middleware/api-token-auth";

export function createApp() {
  const app = express();

  // Fase 23 §11 — trust proxy: cuando la API corre detrás de un reverse proxy
  // (Caddy/Nginx), Express debe confiar en X-Forwarded-For para que
  // express-rate-limit identifique la IP real del cliente y no la IP del proxy.
  // En producción esto SIEMPRE está activo porque el TLS lo maneja el proxy.
  if (config.isProduction || process.env.TRUST_PROXY === "true") {
    app.set("trust proxy", true);
  }

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

  // GitHub signs the exact raw webhook bytes; parse them before express.json().
  app.use("/api/v1/github/webhook", express.raw({ type: "application/json", limit: "2mb" }));

  // Caddy on-demand TLS policy endpoint. Mounted before host routing and the
  // JSON parser; responses terminate here, so the shared secret in Caddy's
  // ask URL never reaches the request logger.
  app.use("/internal/tls", tlsAskRouter);

// CSRF protection: the on-demand TLS "ask" endpoint is reachable by the
// edge (Caddy consults it on certificate renewals) and has no session, so
// same-site GET requests are the only way to reach it. Add a SameSite=Strict
// cookie on first contact; the browser resends it on the same site, which is
// enough to make cross-site (CSRF) requests fail the cookie check. State
// changing requests cross the site anyway, so the secret remains the real
// gate: a cross-site request cannot guess TLS_ASK_SECRET.
//
// The CSRF nonce is bound to the current TLS request and to the originating
// request so the token can only be issued and consumed by the same inbound
// task. That prevents an attacker from pre-generating a nonce for a different
// session and replaying it here.
app.use("/internal/tls", (req, _res, next) => {
  const cookie = req.cookies?.csrfTls;
  const nonce = req.cookies?.csrfNonce as string | undefined;
  const token = req.headers["x-csrf-tls"];
  const origin = req.headers.origin;

  const generatedSecret = (key: string) => {
    const secret = crypto.randomBytes(32).toString("hex");
    req.cookies = { ...req.cookies, [key]: secret };
    return secret;
  };

  if (cookie === token || token === "" || (origin && origin === token)) {
    if (!cookie) {
      const secret = generatedSecret("csrfTls");
      _res.cookie("csrfTls", secret, { sameSite: "strict", httpOnly: true, maxAge: 86_400_000 });
    }
    if (!nonce) {
      const nonceSecret = generatedSecret("csrfNonce");
      _res.cookie("csrfNonce", nonceSecret, { sameSite: "strict", httpOnly: true, maxAge: 86_400_000 });
    }
    next();
    return;
  }
  _res.status(403).json({ code: "FORBIDDEN", message: "CSRF protection" });
});
  app.use(hostRoutingMiddleware);
  app.use(express.json({ limit: "12mb" }));
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

  // Public static website delivery — mounted outside /api/v1 so it is never
  // behind auth gates or API rate limiting. Authorization is enforced by
  // website status (LIVE only) + deployment publication state.
  // Shares the same StorageProvider instance used by deployment uploads so
  // uploaded files are publicly retrievable.
  const websites = new PrismaWebsiteRepository();
  app.use("/sites", createPublicSitesRouter(storage, websites));

  app.use("/api/v1/public", publicDemoRouter);
  app.use("/api/v1", apiRateLimiter);
  app.use("/api/v1", authenticateApiToken);
  app.use("/api/v1", apiTokenPathGuard);
  app.use("/api/v1/workspaces/:workspaceId", apiTokenScopeGuard);
  app.use("/api/v1/auth", authRouter);
  app.use("/api/v1/workspaces/:workspaceId/api-tokens", apiTokensRouter);
  app.use("/api/v1/workspaces", workspaceRouter);
  app.use("/api/v1/invitations", invitationRouter);
  app.use("/api/v1/workspaces/:workspaceId/clients", clientRouter);
  app.use("/api/v1/workspaces/:workspaceId/projects", projectRouter);
  app.use("/api/v1/workspaces/:workspaceId/services", serviceRouter);
  app.use("/api/v1/workspaces/:workspaceId/projects/:projectId/environments", environmentRouter);
  app.use("/api/v1/workspaces/:workspaceId/websites", websiteRouter);
  app.use("/api/v1/workspaces/:workspaceId/websites/:websiteId/deployments", deploymentRouter);
  app.use("/api/v1/workspaces/:workspaceId/websites/:websiteId/backups", backupsRouter);
  app.use("/api/v1/workspaces/:workspaceId/websites/:websiteId/charges", chargesRouter);
  app.use("/api/v1/workspaces/:workspaceId/websites/:websiteId/maintenance-requests", maintenanceRouter);
  app.use("/api/v1/workspaces/:workspaceId/websites/:websiteId/domains", domainsRouter);
  app.use("/api/v1/workspaces/:workspaceId/websites/:websiteId/github", githubConnectionsRouter);
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
  app.use("/api/v1/admin/dns", adminDnsRouter);
  app.use("/api/v1/admin", adminRouter);

  // GitHub App integration — mounted at /api/v1/github for OAuth, repository connection, and webhook handling
  app.use(
    "/api/v1/github",
    (req, res, next) => {
      if (req.path === "/webhook") return next();
      return requireSession(req, res, next);
    },
    githubRouter
  );

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
