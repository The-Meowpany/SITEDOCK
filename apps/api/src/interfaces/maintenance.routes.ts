import { Router } from "express";
import { z } from "zod";
import { WebsiteId, WorkspaceId } from "@sitedock/shared";
import {
  AddMaintenanceCommentUseCase,
  ApproveMaintenanceRequestUseCase,
  CancelMaintenanceRequestUseCase,
  CompleteMaintenanceRequestUseCase,
  CreateMaintenanceRequestUseCase,
  GetMaintenanceAllowanceForWebsiteUseCase,
  ListMaintenanceCommentsUseCase,
  ListMaintenanceRequestsUseCase,
  MarkMaintenanceRequestPaidUseCase,
  PrismaMaintenanceCommentRepository,
  PrismaMaintenanceRequestRepository,
  QuoteMaintenanceRequestUseCase,
  RequestChangesOnMaintenanceRequestUseCase,
  StartMaintenanceRequestUseCase,
} from "@sitedock/maintenance";
import { PrismaServicePlanRepository, PrismaSubscriptionRepository, previousPeriodStart } from "@sitedock/billing";
import { AssertWorkspaceAccessUseCase, PrismaWorkspaceRepository } from "@sitedock/workspace";
import { assertWebsiteAccess } from "../middleware/access-control";
import { requireSession } from "../middleware/require-session";
import { auditBestEffort } from "../audit";

const requests = new PrismaMaintenanceRequestRepository();
const comments = new PrismaMaintenanceCommentRepository();
const workspaces = new PrismaWorkspaceRepository();
const subscriptions = new PrismaSubscriptionRepository();
const plans = new PrismaServicePlanRepository();
const assertWorkspaceAccess = new AssertWorkspaceAccessUseCase(workspaces);

const createRequest = new CreateMaintenanceRequestUseCase(requests);
const getAllowance = new GetMaintenanceAllowanceForWebsiteUseCase(requests);
const quoteRequest = new QuoteMaintenanceRequestUseCase(requests);
const markPaid = new MarkMaintenanceRequestPaidUseCase(requests);
const startRequest = new StartMaintenanceRequestUseCase(requests);
const completeRequest = new CompleteMaintenanceRequestUseCase(requests);
const approveRequest = new ApproveMaintenanceRequestUseCase(requests);
const requestChanges = new RequestChangesOnMaintenanceRequestUseCase(requests);
const cancelRequest = new CancelMaintenanceRequestUseCase(requests);
const listRequests = new ListMaintenanceRequestsUseCase(requests);
const addComment = new AddMaintenanceCommentUseCase(requests, comments);
const listComments = new ListMaintenanceCommentsUseCase(requests, comments);

type WebsiteScopedParams = { workspaceId: string; websiteId: string };
type RequestParams = WebsiteScopedParams & { requestId: string };

// Mounted at /api/v1/workspaces/:workspaceId/websites/:websiteId/maintenance-requests
export const maintenanceRouter = Router({ mergeParams: true });
maintenanceRouter.use(requireSession);

const createSchema = z.object({ title: z.string().min(3), description: z.string().min(1) });
const quoteSchema = z.object({ priceDecimal: z.string().regex(/^\d+(\.\d{1,2})?$/), currency: z.string().length(3).default("USD") });
const commentSchema = z.object({ body: z.string().min(1) });

type TierCoverage =
  | { hasMembership: false }
  | {
      hasMembership: true;
      covered: boolean;
      quotaIncluded: number | null;
      usedThisPeriod: number;
      remaining: number | null;
      planName: string;
    };

/**
 * Composes Billing (MAINTENANCE membership + plan quota) with Maintenance
 * (usage count) into the tier-coverage view. The interfaces layer is where
 * cross-context reads live; shared by GET /allowance and POST /.
 */
async function resolveTierCoverage(websiteId: string, workspaceId: string): Promise<TierCoverage> {
  const membership = await subscriptions.findByWebsiteIdAndKind(WebsiteId(websiteId), "MAINTENANCE");
  if (!membership) return { hasMembership: false };

  const plan = await plans.findByIdInWorkspace(membership.planId, WorkspaceId(workspaceId));
  // Period boundaries mirror Subscription.addInterval backwards from nextBillingDate.
  const periodEnd = membership.nextBillingDate ?? new Date();
  const periodStart = previousPeriodStart(periodEnd, membership.billingInterval);

  const allowance = await getAllowance.execute({
    websiteId,
    quotaIncluded: plan?.includedRequestQuota ?? null,
    periodStart,
    periodEnd,
  });

  return {
    hasMembership: true,
    covered: !allowance.overQuota && (membership.status === "ACTIVE" || membership.status === "TRIALING"),
    quotaIncluded: allowance.quotaIncluded,
    usedThisPeriod: allowance.usedThisPeriod,
    remaining: allowance.remaining,
    planName: plan?.name ?? "Mantenimiento",
  };
}

/**
 * Maintenance-tier allowance for this website: how many included requests the
 * client's MAINTENANCE membership covers in the current billing period, and
 * whether they're already over quota (extra work → quote path).
 */
maintenanceRouter.get<WebsiteScopedParams>("/allowance", async (req, res, next) => {
  try {
    await assertWebsiteAccess({
      workspaceId: req.params.workspaceId,
      userId: req.userId!,
      websiteId: req.params.websiteId,
    });

    const membership = await subscriptions.findByWebsiteIdAndKind(
      WebsiteId(req.params.websiteId),
      "MAINTENANCE"
    );
    if (!membership) {
      res.json({ hasMembership: false });
      return;
    }

    const plan = await plans.findByIdInWorkspace(membership.planId, WorkspaceId(req.params.workspaceId));
    // Period boundaries mirror Subscription.addInterval backwards from nextBillingDate.
    const periodEnd = membership.nextBillingDate ?? new Date();
    const periodStart = previousPeriodStart(periodEnd, membership.billingInterval);

    const allowance = await getAllowance.execute({
      websiteId: req.params.websiteId,
      quotaIncluded: plan?.includedRequestQuota ?? null,
      periodStart,
      periodEnd,
    });

    res.json({
      hasMembership: true,
      status: membership.status,
      planName: plan?.name ?? "Mantenimiento",
      priceDecimal: membership.price.toDecimalString(),
      currency: membership.price.currency,
      billingInterval: membership.billingInterval,
      nextBillingDate: membership.nextBillingDate,
      ...allowance,
    });
  } catch (err) {
    next(err);
  }
});

maintenanceRouter.post<WebsiteScopedParams>("/", async (req, res, next) => {
  try {
    await assertWebsiteAccess({ workspaceId: req.params.workspaceId, userId: req.userId!, websiteId: req.params.websiteId });
    const body = createSchema.parse(req.body);
    const result = await createRequest.execute({ websiteId: req.params.websiteId, ...body });

    // Tell the caller whether the tier covers this request or it lands in the
    // quote path — the portal surfaces this right after submitting.
    let tier: TierCoverage;
    try {
      tier = await resolveTierCoverage(req.params.websiteId, req.params.workspaceId);
    } catch {
      tier = { hasMembership: false };
    }

    auditBestEffort({ workspaceId: req.params.workspaceId, actorId: req.userId!, action: "MAINTENANCE_REQUEST_CREATED", resourceType: "MaintenanceRequest", resourceId: result.requestId });
    res.status(201).json({ ...result, tier });
  } catch (err) {
    next(err);
  }
});

maintenanceRouter.get<WebsiteScopedParams>("/", async (req, res, next) => {
  try {
    await assertWebsiteAccess({ workspaceId: req.params.workspaceId, userId: req.userId!, websiteId: req.params.websiteId });
    res.json(await listRequests.execute(req.params.websiteId));
  } catch (err) {
    next(err);
  }
});

maintenanceRouter.post<RequestParams>("/:requestId/quote", async (req, res, next) => {
  try {
    await assertWorkspaceAccess.execute({ workspaceId: req.params.workspaceId, userId: req.userId!, requiredRoles: ["OWNER", "ADMIN", "DEVELOPER"] });
    const { priceDecimal, currency } = quoteSchema.parse(req.body);
    const cents = Math.round(parseFloat(priceDecimal) * 100);
    await quoteRequest.execute({ requestId: req.params.requestId, websiteId: req.params.websiteId, priceCents: cents, currency });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

maintenanceRouter.post<RequestParams>("/:requestId/mark-paid", async (req, res, next) => {
  try {
    await assertWorkspaceAccess.execute({ workspaceId: req.params.workspaceId, userId: req.userId!, requiredRoles: ["OWNER", "ADMIN", "DEVELOPER"] });
    await markPaid.execute(req.params.requestId, req.params.websiteId);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

maintenanceRouter.post<RequestParams>("/:requestId/start", async (req, res, next) => {
  try {
    await assertWorkspaceAccess.execute({ workspaceId: req.params.workspaceId, userId: req.userId!, requiredRoles: ["OWNER", "ADMIN", "DEVELOPER"] });
    await startRequest.execute(req.params.requestId, req.params.websiteId);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

maintenanceRouter.post<RequestParams>("/:requestId/complete", async (req, res, next) => {
  try {
    await assertWorkspaceAccess.execute({ workspaceId: req.params.workspaceId, userId: req.userId!, requiredRoles: ["OWNER", "ADMIN", "DEVELOPER"] });
    await completeRequest.execute(req.params.requestId, req.params.websiteId);
    auditBestEffort({ workspaceId: req.params.workspaceId, actorId: req.userId!, action: "MAINTENANCE_REQUEST_COMPLETED", resourceType: "MaintenanceRequest", resourceId: req.params.requestId });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

maintenanceRouter.post<RequestParams>("/:requestId/approve", async (req, res, next) => {
  try {
    await assertWebsiteAccess({ workspaceId: req.params.workspaceId, userId: req.userId!, websiteId: req.params.websiteId });
    await approveRequest.execute(req.params.requestId, req.params.websiteId);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

maintenanceRouter.post<RequestParams>("/:requestId/request-changes", async (req, res, next) => {
  try {
    await assertWebsiteAccess({ workspaceId: req.params.workspaceId, userId: req.userId!, websiteId: req.params.websiteId });
    await requestChanges.execute(req.params.requestId, req.params.websiteId);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

maintenanceRouter.post<RequestParams>("/:requestId/cancel", async (req, res, next) => {
  try {
    await assertWebsiteAccess({ workspaceId: req.params.workspaceId, userId: req.userId!, websiteId: req.params.websiteId });
    await cancelRequest.execute(req.params.requestId, req.params.websiteId);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

maintenanceRouter.post<RequestParams>("/:requestId/comments", async (req, res, next) => {
  try {
    await assertWebsiteAccess({ workspaceId: req.params.workspaceId, userId: req.userId!, websiteId: req.params.websiteId });
    const { body } = commentSchema.parse(req.body);
    res.status(201).json(await addComment.execute({ requestId: req.params.requestId, websiteId: req.params.websiteId, authorId: req.userId!, body }));
  } catch (err) {
    next(err);
  }
});

maintenanceRouter.get<RequestParams>("/:requestId/comments", async (req, res, next) => {
  try {
    await assertWebsiteAccess({ workspaceId: req.params.workspaceId, userId: req.userId!, websiteId: req.params.websiteId });
    res.json(await listComments.execute(req.params.requestId, req.params.websiteId));
  } catch (err) {
    next(err);
  }
});



