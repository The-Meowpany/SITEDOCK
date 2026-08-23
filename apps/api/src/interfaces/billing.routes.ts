import { Router } from "express";
import { z } from "zod";
import { ApplicationError, WebsiteId } from "@sitedock/shared";
import {
  CreateCheckoutSessionUseCase,
  CreateServicePlanUseCase,
  UpdateServicePlanUseCase,
  CreateSubscriptionUseCase,
  GetSubscriptionForWebsiteUseCase,
  ListServicePlansUseCase,
  SyncConnectedAccountStatusUseCase,
  PrismaConnectedAccountRepository,
} from "@sitedock/billing";
import {
  AssignClientToWebsiteUseCase,
  MarkWebsiteGracePeriodUseCase,
  MarkWebsitePastDueUseCase,
  PrismaWebsiteRepository,
  ReactivateWebsiteUseCase,
  SuspendWebsiteUseCase,
} from "@sitedock/website";
import { PrismaClientRepository } from "@sitedock/client";
import { AssertWorkspaceAccessUseCase, PrismaWorkspaceRepository } from "@sitedock/workspace";
import { requireSession } from "../middleware/require-session";
import { assertWebsiteAccess } from "../middleware/access-control";
import {
  subscriptions,
  plans,
  paymentProvider,
  processWebhook,
  demoSimulator,
  connectedAccountGateway,
} from "../billing-container";
import { logger } from "../logger";
import { notifyBestEffort } from "../notifications";
import { auditBestEffort } from "../audit";

const connectedAccountsRepo = new PrismaConnectedAccountRepository();

const websites = new PrismaWebsiteRepository();
const clients = new PrismaClientRepository();
const workspaces = new PrismaWorkspaceRepository();

const assertWorkspaceAccess = new AssertWorkspaceAccessUseCase(workspaces);
const createServicePlan = new CreateServicePlanUseCase(plans);
const updateServicePlan = new UpdateServicePlanUseCase(plans);
const listServicePlans = new ListServicePlansUseCase(plans);
const createSubscription = new CreateSubscriptionUseCase(subscriptions, plans);
const getSubscription = new GetSubscriptionForWebsiteUseCase(subscriptions);
const createCheckoutSession = new CreateCheckoutSessionUseCase(subscriptions, paymentProvider);
const assignClient = new AssignClientToWebsiteUseCase(websites);
const markPastDue = new MarkWebsitePastDueUseCase(websites);
const markGracePeriod = new MarkWebsiteGracePeriodUseCase(websites);
const suspendWebsite = new SuspendWebsiteUseCase(websites);
const reactivateWebsite = new ReactivateWebsiteUseCase(websites);

// Tiers are fully freelancer-defined: name, price, interval and — for
// MAINTENANCE plans — how many modification requests each period includes.
const createPlanSchema = z.object({
  name: z.string().min(2),
  kind: z.enum(["HOSTING", "MAINTENANCE"]).default("HOSTING"),
  priceDecimal: z.string().regex(/^\d+(\.\d{1,2})?$/),
  currency: z.string().length(3).default("USD"),
  billingInterval: z.enum(["MONTHLY", "YEARLY"]),
  includedRequestQuota: z.number().int().min(0).nullable().optional(),
  features: z.record(z.any()).optional(),
});

const updatePlanSchema = z.object({
  name: z.string().min(2).optional(),
  priceDecimal: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
  currency: z.string().length(3).optional(),
  billingInterval: z.enum(["MONTHLY", "YEARLY"]).optional(),
  includedRequestQuota: z.number().int().min(0).nullable().optional(),
  features: z.record(z.any()).optional(),
  active: z.boolean().optional(),
});

type WorkspaceParams = { workspaceId: string };
type WebsiteScopedParams = WorkspaceParams & { websiteId: string };

// Mounted at /api/v1/workspaces/:workspaceId/plans
export const servicePlanRouter = Router({ mergeParams: true });
servicePlanRouter.use(requireSession);

servicePlanRouter.post<WorkspaceParams>("/", async (req, res, next) => {
  try {
    await assertWorkspaceAccess.execute({ workspaceId: req.params.workspaceId, userId: req.userId!, requiredRoles: ["OWNER", "ADMIN", "DEVELOPER"] });
    const body = createPlanSchema.parse(req.body);
    const result = await createServicePlan.execute({ workspaceId: req.params.workspaceId, ...body });
    auditBestEffort({ workspaceId: req.params.workspaceId, actorId: req.userId!, action: "PLAN_CREATED", resourceType: "ServicePlan", resourceId: result.planId });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

servicePlanRouter.get<WorkspaceParams>("/", async (req, res, next) => {
  try {
    await assertWorkspaceAccess.execute({ workspaceId: req.params.workspaceId, userId: req.userId! });
    const kind = z.enum(["HOSTING", "MAINTENANCE"]).optional().parse(req.query.kind);
    res.json(await listServicePlans.execute(req.params.workspaceId, kind));
  } catch (err) {
    next(err);
  }
});

/**
 * Edits a freelancer-defined tier. Price changes apply to future
 * subscriptions only — existing ones keep their captured price.
 */
servicePlanRouter.patch<WorkspaceParams & { planId: string }>("/:planId", async (req, res, next) => {
  try {
    await assertWorkspaceAccess.execute({
      workspaceId: req.params.workspaceId,
      userId: req.userId!,
      requiredRoles: ["OWNER", "ADMIN", "DEVELOPER"],
    });
    const body = updatePlanSchema.parse(req.body);
    const result = await updateServicePlan.execute({ workspaceId: req.params.workspaceId, planId: req.params.planId, ...body });
    auditBestEffort({
      workspaceId: req.params.workspaceId,
      actorId: req.userId!,
      action: "PLAN_UPDATED",
      resourceType: "ServicePlan",
      resourceId: result.planId,
      metadata: { fields: Object.keys(body) },
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Mounted at /api/v1/workspaces/:workspaceId/websites/:websiteId/subscription
export const subscriptionRouter = Router({ mergeParams: true });
subscriptionRouter.use(requireSession);

const createSubscriptionSchema = z.object({ planId: z.string().uuid() });
const assignClientSchema = z.object({ clientId: z.string().uuid() });
const checkoutSchema = z.object({
  successUrl: z.string().url().default("https://sitedock.demo/checkout/success"),
  cancelUrl: z.string().url().default("https://sitedock.demo/checkout/cancel"),
});

subscriptionRouter.post<WebsiteScopedParams>("/assign-client", async (req, res, next) => {
  try {
    await assertWorkspaceAccess.execute({ workspaceId: req.params.workspaceId, userId: req.userId!, requiredRoles: ["OWNER", "ADMIN", "DEVELOPER"] });
    const { clientId } = assignClientSchema.parse(req.body);
    await assignClient.execute({ websiteId: req.params.websiteId, workspaceId: req.params.workspaceId, clientId });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

subscriptionRouter.post<WebsiteScopedParams>("/", async (req, res, next) => {
  try {
    await assertWorkspaceAccess.execute({ workspaceId: req.params.workspaceId, userId: req.userId!, requiredRoles: ["OWNER", "ADMIN", "DEVELOPER"] });
    const { planId } = createSubscriptionSchema.parse(req.body);
    const result = await createSubscription.execute({
      workspaceId: req.params.workspaceId,
      websiteId: req.params.websiteId,
      planId,
      paymentProvider: paymentProvider.name,
    });
    auditBestEffort({
      workspaceId: req.params.workspaceId,
      actorId: req.userId!,
      action: "SUBSCRIPTION_CREATED",
      resourceType: "Subscription",
      resourceId: result.subscriptionId,
      metadata: { websiteId: req.params.websiteId, planId },
    });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * Read-only endpoint used by both the developer dashboard and the Client
 * Portal (docs/ARCHITECTURE.md §15). Any workspace member can read it — unlike
 * the write endpoints above, no role restriction is needed here.
 */
subscriptionRouter.get<WebsiteScopedParams>("/", async (req, res, next) => {
  try {
    await assertWebsiteAccess({ workspaceId: req.params.workspaceId, userId: req.userId!, websiteId: req.params.websiteId });
    const kind = z.enum(["HOSTING", "MAINTENANCE"]).default("HOSTING").parse(req.query.kind);
    const result = await getSubscription.execute(req.params.websiteId, kind);
    if (!result) {
      res.status(404).json({ code: "NOT_FOUND", message: "No subscription exists for this website yet" });
      return;
    }
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * Generates the checkout link the developer sends to their client
 * (docs/ARCHITECTURE.md §9 flow step 8-9). The response is only ever a URL —
 * the frontend never confirms payment itself.
 */
subscriptionRouter.post<WebsiteScopedParams & { subscriptionId: string }>("/:subscriptionId/checkout", async (req, res, next) => {
  try {
    await assertWorkspaceAccess.execute({ workspaceId: req.params.workspaceId, userId: req.userId!, requiredRoles: ["OWNER", "ADMIN", "DEVELOPER"] });
    const body = checkoutSchema.parse(req.body ?? {});
    const result = await createCheckoutSession.execute({
      subscriptionId: req.params.subscriptionId,
      successUrl: body.successUrl,
      cancelUrl: body.cancelUrl,
    });
    auditBestEffort({
      workspaceId: req.params.workspaceId,
      actorId: req.userId!,
      action: "CHECKOUT_CREATED",
      resourceType: "Subscription",
      resourceId: req.params.subscriptionId,
    });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * Applies the outcome of a processed webhook to the Website lifecycle and
 * notifies the client. Billing never mutates Website state directly — it only
 * knows the websiteId, so this helper resolves the website's workspaceId
 * first (an internal, verified-webhook operation, not a user request, so
 * bypassing the membership check itself is correct — but the tenant-scoped
 * use cases still need a real workspaceId).
 */
async function applySubscriptionOutcomeToWebsite(websiteId: string, subscriptionStatus?: string) {
  const website = await websites.findById(WebsiteId(websiteId));
  if (!website) return;

  let wasReactivated = false;

  try {
    if (subscriptionStatus === "ACTIVE") {
      const beforeStatus = website.status;
      await reactivateWebsite.execute(websiteId, website.workspaceId);
      wasReactivated = beforeStatus === "SUSPENDED" || beforeStatus === "GRACE_PERIOD" || beforeStatus === "PAST_DUE";
    } else if (subscriptionStatus === "PAST_DUE") {
      await markPastDue.execute(websiteId, website.workspaceId);
    }
  } catch (lifecycleErr) {
    // Website may already be in the target status (e.g. first-ever publish
    // already set it LIVE) — log and don't fail the webhook ACK, since the
    // payment/subscription side is already durably recorded.
    logger.warn({ err: lifecycleErr, websiteId }, "Website lifecycle transition skipped after webhook");
  }

  if (subscriptionStatus === "ACTIVE") {
    auditBestEffort({ workspaceId: website.workspaceId, actorId: null, action: "PAYMENT_RECEIVED", resourceType: "Website", resourceId: websiteId });
    if (wasReactivated) {
      auditBestEffort({ workspaceId: website.workspaceId, actorId: null, action: "WEBSITE_REACTIVATED", resourceType: "Website", resourceId: websiteId });
    }
  } else if (subscriptionStatus === "PAST_DUE") {
    auditBestEffort({ workspaceId: website.workspaceId, actorId: null, action: "PAYMENT_FAILED", resourceType: "Website", resourceId: websiteId });
  }

  if (!website.clientId) return;
  const client = await clients.findById(website.clientId);
  if (!client) return;

  if (subscriptionStatus === "ACTIVE") {
    const subscription = await subscriptions.findByWebsiteId(WebsiteId(websiteId));
    notifyBestEffort({
      type: "payment_succeeded",
      recipientEmail: client.email.value,
      websiteName: website.name,
      amountDecimal: subscription?.price.toDecimalString() ?? "",
      currency: subscription?.price.currency ?? "",
    });
  } else if (subscriptionStatus === "PAST_DUE") {
    notifyBestEffort({ type: "payment_failed", recipientEmail: client.email.value, websiteName: website.name, reason: "payment_declined" });
  }
}

/**
 * Real payment webhook endpoint, mounted separately at the top level
 * (/api/v1/webhooks/payments/:provider) with a raw-body parser BEFORE the
 * global express.json() middleware — signature verification requires the
 * exact bytes the provider signed, not a re-serialized JSON object
 * (docs/ARCHITECTURE.md §16/§76). Every event is deduplicated by
 * (provider, eventId) inside ProcessPaymentWebhookUseCase before it can
 * mutate any subscription.
 */
export const paymentWebhookRouter = Router();

paymentWebhookRouter.post("/:provider", async (req, res, next) => {
  try {
    const provider = req.params.provider;
    if (provider !== paymentProvider.name) {
      throw new ApplicationError(`Unknown payment provider: ${provider}`, "UNKNOWN_PAYMENT_PROVIDER");
    }

    // Cada provider firma con su propio header.
    const signatureHeader =
      provider === "stripe" ? "stripe-signature" : "x-sitedock-signature";
    const signature = req.header(signatureHeader) ?? "";
    const rawBody: Buffer = req.body; // populated by express.raw() for this route only

    // Fase 16 — Connect: account.updated sincroniza el estado del merchant
    // (KYC/capabilities) ANTES del pipeline económico, que no lo consume.
    if (provider === "stripe") {
      let envelopeType: string | undefined;
      let accountId: string | undefined;
      try {
        const probe = JSON.parse(rawBody.toString("utf8")) as {
          type?: string;
          data?: { object?: { id?: string } };
        };
        envelopeType = probe.type;
        accountId = probe.data?.object?.id;
      } catch {
        /* JSON inválido: verifyAndParseWebhook lo rechazará abajo */
      }
      if (envelopeType === "account.updated" && accountId) {
        await new SyncConnectedAccountStatusUseCase(connectedAccountsRepo, connectedAccountGateway!).execute({
          workspaceId: "",
          externalAccountId: accountId,
        });
        return res.status(200).json({ received: true, type: envelopeType });
      }
    }

    const event = paymentProvider.verifyAndParseWebhook(rawBody, signature);
    const result = await processWebhook.execute(provider, event, rawBody);

    if (!result.duplicate && result.websiteId) {
      await applySubscriptionOutcomeToWebsite(result.websiteId, result.subscriptionStatus);
    }

    res.status(200).json({ received: true, duplicate: result.duplicate });
  } catch (err) {
    next(err);
  }
});

/**
 * Demo-only helper: signs and delivers a webhook payload through the SAME
 * verify→idempotency→lifecycle path as the real endpoint above, without
 * needing an actual payment provider (docs/ARCHITECTURE.md §45).
 */
export const demoPaymentRouter = Router({ mergeParams: true });
demoPaymentRouter.use(requireSession);

const demoCheckoutSessionSchema = z.object({ checkoutSessionId: z.string().min(1) });

demoPaymentRouter.post<WorkspaceParams>("/simulate-payment-succeeded", async (req, res, next) => {
  try {
    await assertWorkspaceAccess.execute({ workspaceId: req.params.workspaceId, userId: req.userId!, requiredRoles: ["OWNER", "ADMIN", "DEVELOPER"] });
    if (!demoSimulator) throw new ApplicationError("Demo endpoints require PAYMENT_PROVIDER=mock", "DEMO_NOT_AVAILABLE");
    const { checkoutSessionId } = demoCheckoutSessionSchema.parse(req.body);
    const { rawBody, signature } = demoSimulator.simulateSuccessfulPayment(checkoutSessionId);
    const event = paymentProvider.verifyAndParseWebhook(rawBody, signature);
    const result = await processWebhook.execute(paymentProvider.name, event, rawBody);
    if (!result.duplicate && result.websiteId) {
      await applySubscriptionOutcomeToWebsite(result.websiteId, result.subscriptionStatus);
    }
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * Demo completion of a ONE-TIME project charge. Same verify→claim→process
 * pipeline as the real webhook; the charge's PAID state is set there and the
 * client-facing website lifecycle is untouched (charges don't affect it).
 */
demoPaymentRouter.post<WorkspaceParams>("/simulate-charge-succeeded", async (req, res, next) => {
  try {
    await assertWorkspaceAccess.execute({ workspaceId: req.params.workspaceId, userId: req.userId!, requiredRoles: ["OWNER", "ADMIN", "DEVELOPER"] });
    if (!demoSimulator) throw new ApplicationError("Demo endpoints require PAYMENT_PROVIDER=mock", "DEMO_NOT_AVAILABLE");
    const { checkoutSessionId } = demoCheckoutSessionSchema.parse(req.body);
    const { rawBody, signature } = demoSimulator.simulateSuccessfulCharge(checkoutSessionId);
    const event = paymentProvider.verifyAndParseWebhook(rawBody, signature);
    const result = await processWebhook.execute(paymentProvider.name, event, rawBody);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

demoPaymentRouter.post<WorkspaceParams>("/simulate-payment-failed", async (req, res, next) => {
  try {
    await assertWorkspaceAccess.execute({ workspaceId: req.params.workspaceId, userId: req.userId!, requiredRoles: ["OWNER", "ADMIN", "DEVELOPER"] });
    if (!demoSimulator) throw new ApplicationError("Demo endpoints require PAYMENT_PROVIDER=mock", "DEMO_NOT_AVAILABLE");
    const { checkoutSessionId } = demoCheckoutSessionSchema.parse(req.body);
    const { rawBody, signature } = demoSimulator.simulateFailedPayment(checkoutSessionId);
    const event = paymentProvider.verifyAndParseWebhook(rawBody, signature);
    const result = await processWebhook.execute(paymentProvider.name, event, rawBody);
    if (!result.duplicate && result.websiteId) {
      await applySubscriptionOutcomeToWebsite(result.websiteId, result.subscriptionStatus);
    }
    res.json(result);
  } catch (err) {
    next(err);
  }
});

demoPaymentRouter.post<WorkspaceParams>("/suspend-for-nonpayment", async (req, res, next) => {
  try {
    await assertWorkspaceAccess.execute({ workspaceId: req.params.workspaceId, userId: req.userId!, requiredRoles: ["OWNER", "ADMIN", "DEVELOPER"] });
    const { websiteId } = z.object({ websiteId: z.string().uuid() }).parse(req.body);
    await markGracePeriod.execute(websiteId, req.params.workspaceId);
    await suspendWebsite.execute(websiteId, req.params.workspaceId);

    auditBestEffort({ workspaceId: req.params.workspaceId, actorId: req.userId!, action: "WEBSITE_SUSPENDED", resourceType: "Website", resourceId: websiteId });

    const website = await websites.findById(WebsiteId(websiteId));
    if (website?.clientId) {
      const client = await clients.findById(website.clientId);
      if (client) {
        notifyBestEffort({ type: "website_suspended", recipientEmail: client.email.value, websiteName: website.name });
      }
    }

    res.status(204).send();
  } catch (err) {
    next(err);
  }
});












