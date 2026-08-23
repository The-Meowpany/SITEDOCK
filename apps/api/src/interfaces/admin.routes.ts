import { Router } from "express";
import { NotFoundError, WebsiteId } from "@sitedock/shared";
import {
  ListPlatformPaymentsUseCase,
  ListPlatformTenantsUseCase,
  ListPlatformUsersUseCase,
  ListPlatformWebhookEventsUseCase,
  ListPlatformWebsitesUseCase,
  GetPlatformOverviewUseCase,
  PrismaPlatformAdminReader,
} from "@sitedock/admin";
import { PrismaUserRepository, ReinstateUserUseCase, SuspendUserUseCase } from "@sitedock/auth";
import { PrismaWebsiteRepository, SuspendWebsiteUseCase } from "@sitedock/website";
import { PrismaClientRepository } from "@sitedock/client";
import { NotificationService, MockEmailProvider, PrismaNotificationLogRepository } from "@sitedock/notification";
import { requireSession } from "../middleware/require-session";
import { requirePlatformAdmin } from "../middleware/require-platform-admin";
import { auditBestEffort } from "../audit";
import { logger } from "../logger";

const reader = new PrismaPlatformAdminReader();
const users = new PrismaUserRepository();
const websites = new PrismaWebsiteRepository();
const clients = new PrismaClientRepository();

const getOverview = new GetPlatformOverviewUseCase(reader);
const listTenants = new ListPlatformTenantsUseCase(reader);
const listUsers = new ListPlatformUsersUseCase(reader);
const listWebsites = new ListPlatformWebsitesUseCase(reader);
const listPayments = new ListPlatformPaymentsUseCase(reader);
const listWebhookEvents = new ListPlatformWebhookEventsUseCase(reader);

const suspendUser = new SuspendUserUseCase(users);
const reinstateUser = new ReinstateUserUseCase(users);
const suspendWebsite = new SuspendWebsiteUseCase(websites);

// Demo-mode email wiring — same pattern as every other router (swapped for a
// real provider in production without touching this file).
const notifications = new NotificationService(new MockEmailProvider(), new PrismaNotificationLogRepository());

const parseLimit = (raw: unknown, fallback: number, max: number): number => {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) return fallback;
  return Math.min(n, max);
};

/**
 * Platform administration API (brief §27). Every route requires BOTH gates:
 * requireSession → requirePlatformAdmin. Every mutation writes an auditable
 * entry via auditBestEffort with the acting admin as actorId.
 *
 * Mounted at /api/v1/admin.
 */
export const adminRouter = Router();
adminRouter.use(requireSession, requirePlatformAdmin);

adminRouter.get("/overview", async (_req, res, next) => {
  try {
    res.json(await getOverview.execute());
  } catch (err) {
    next(err);
  }
});

adminRouter.get("/workspaces", async (req, res, next) => {
  try {
    res.json(await listTenants.execute(parseLimit(req.query.limit, 50, 200)));
  } catch (err) {
    next(err);
  }
});

adminRouter.get("/users", async (req, res, next) => {
  try {
    res.json(await listUsers.execute(parseLimit(req.query.limit, 100, 500)));
  } catch (err) {
    next(err);
  }
});

adminRouter.post("/users/:id/suspend", async (req, res, next) => {
  try {
    const result = await suspendUser.execute({ userId: req.params.id });
    auditBestEffort({
      workspaceId: null,
      actorId: req.userId!,
      action: "ADMIN_ACTION",
      resourceType: "User",
      resourceId: req.params.id,
      metadata: { operation: "USER_SUSPENDED" },
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

adminRouter.post("/users/:id/reinstate", async (req, res, next) => {
  try {
    const result = await reinstateUser.execute({ userId: req.params.id });
    auditBestEffort({
      workspaceId: null,
      actorId: req.userId!,
      action: "ADMIN_ACTION",
      resourceType: "User",
      resourceId: req.params.id,
      metadata: { operation: "USER_REINSTATED" },
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

adminRouter.get("/websites", async (req, res, next) => {
  try {
    res.json(await listWebsites.execute(parseLimit(req.query.limit, 100, 500)));
  } catch (err) {
    next(err);
  }
});

adminRouter.post("/websites/:id/suspend", async (req, res, next) => {
  try {
    const website = await reader.findWebsiteForAdmin(req.params.id);
    if (!website) throw new NotFoundError("Website", req.params.id);

    await suspendWebsite.execute(website.id, website.workspaceId);

    auditBestEffort({
      workspaceId: website.workspaceId,
      actorId: req.userId!,
      action: "WEBSITE_SUSPENDED",
      resourceType: "Website",
      resourceId: website.id,
      metadata: { by: "PLATFORM_ADMIN" },
    });

    // Best-effort client notification, mirroring the demo suspension route.
    try {
      const full = await websites.findById(WebsiteId(website.id));
      if (full?.clientId) {
        const client = await clients.findById(full.clientId);
        if (client) {
          await notifications.notify({
            type: "website_suspended",
            recipientEmail: client.email.value,
            websiteName: full.name,
          });
        }
      }
    } catch (notifyErr) {
      logger.warn({ err: notifyErr, websiteId: website.id }, "Admin suspension succeeded but client notification failed");
    }

    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

adminRouter.get("/payments", async (req, res, next) => {
  try {
    res.json(await listPayments.execute(parseLimit(req.query.limit, 50, 200)));
  } catch (err) {
    next(err);
  }
});

adminRouter.get("/webhook-events", async (req, res, next) => {
  try {
    res.json(await listWebhookEvents.execute(parseLimit(req.query.limit, 50, 200)));
  } catch (err) {
    next(err);
  }
});
