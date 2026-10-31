import { Router } from "express";
import { z } from "zod";
import { NotFoundError } from "@sitedock/shared";
import {
  CreateRefundUseCase,
  PrismaConnectedAccountRepository,
  PrismaInvoiceRepository,
  PrismaRefundRepository,
  PrismaSubscriptionRepository,
  StartMerchantOnboardingUseCase,
  SyncConnectedAccountStatusUseCase,
} from "@sitedock/billing";
import { PrismaWebsiteRepository } from "@sitedock/website";
import {
  connectedAccountGateway,
  paymentsRepo,
  refundGateway,
  reconcilePayments,
} from "../billing-container";
import { AssertWorkspaceAccessUseCase, PrismaWorkspaceRepository } from "@sitedock/workspace";
import { requireSession } from "../middleware/require-session";
import { requirePlatformAdmin } from "../middleware/require-platform-admin";
import { auditBestEffort } from "../audit";

const accounts = new PrismaConnectedAccountRepository();
const invoices = new PrismaInvoiceRepository();
const subscriptions = new PrismaSubscriptionRepository();
const websites = new PrismaWebsiteRepository();
const assertWorkspaceAccess = new AssertWorkspaceAccessUseCase(new PrismaWorkspaceRepository());

const startOnboarding = new StartMerchantOnboardingUseCase(accounts, connectedAccountGateway!);
const syncStatus = new SyncConnectedAccountStatusUseCase(accounts, connectedAccountGateway!);
const createRefund = new CreateRefundUseCase(paymentsRepo, refundGateway!, new PrismaRefundRepository());

function requireStripeConfigured(res: import("express").Response): boolean {
  if (!connectedAccountGateway || !refundGateway) {
    res.status(501).json({
      code: "STRIPE_NOT_CONFIGURED",
      message: "Stripe is not enabled in this environment (PAYMENT_PROVIDER=stripe required)",
    });
    return false;
  }
  return true;
}

/**
 * Verifies that the payment belongs to the workspace before touching money:
 * Payment → Invoice → Subscription → Website → workspaceId.
 */
async function assertPaymentInWorkspace(paymentId: string, workspaceId: string) {
  const payment = await paymentsRepo.findById(paymentId);
  if (!payment) throw new NotFoundError("Payment", paymentId);

  const invoice = await invoices.findById(payment.invoiceId);
  if (!invoice?.subscriptionId) throw new NotFoundError("Invoice", payment.invoiceId);

  const subscription = await subscriptions.findById(invoice.subscriptionId as never);
  if (!subscription) throw new NotFoundError("Subscription", String(invoice.subscriptionId));

  const website = await websites.findById(subscription.websiteId);
  if (!website || website.workspaceId !== workspaceId) {
    throw new NotFoundError("Website", subscription.websiteId as unknown as string);
  }
}

// ── Merchant onboarding (Connect Express) ────────────────

type WorkspaceParams = { workspaceId: string };

export const merchantRouter = Router({ mergeParams: true });
merchantRouter.use(requireSession);

const connectSchema = z.object({ country: z.string().length(2).default("US") });

merchantRouter.post<WorkspaceParams>("/connect", async (req, res, next) => {
  try {
    if (!requireStripeConfigured(res)) return;
    await assertWorkspaceAccess.execute({
      workspaceId: req.params.workspaceId,
      userId: req.userId!,
      requiredRoles: ["OWNER", "ADMIN"],
    });
    const body = connectSchema.parse(req.body ?? {});
    const result = await startOnboarding.execute({
      workspaceId: req.params.workspaceId,
      country: body.country,
      returnUrl: `${req.protocol}://${req.get("host")}/merchant/return`,
      refreshUrl: `${req.protocol}://${req.get("host")}/merchant/refresh`,
    });
    auditBestEffort({
      workspaceId: req.params.workspaceId,
      actorId: req.userId!,
      action: "ADMIN_ACTION",
      resourceType: "ConnectedAccount",
      resourceId: result.accountId,
      metadata: { operation: "MERCHANT_ONBOARDING_STARTED" },
    });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

merchantRouter.get<WorkspaceParams>("/status", async (req, res, next) => {
  try {
    if (!requireStripeConfigured(res)) return;
    await assertWorkspaceAccess.execute({
      workspaceId: req.params.workspaceId,
      userId: req.userId!,
      requiredRoles: ["OWNER", "ADMIN", "DEVELOPER"],
    });

    const record = await accounts.findByWorkspaceId(
      (await import("@sitedock/shared")).WorkspaceId(req.params.workspaceId)
    );
    if (!record) {
      res.json({ status: "NOT_CONNECTED" as const });
      return;
    }

    const state = await syncStatus.execute({ workspaceId: req.params.workspaceId });
    res.json({
      status: state.chargesEnabled ? ("ACTIVE" as const) : record.status,
      chargesEnabled: state.chargesEnabled,
      payoutsEnabled: state.payoutsEnabled,
      disabledReason: state.disabledReason ?? null,
      onboardedAt: record.onboardedAt,
    });
  } catch (err) {
    next(err);
  }
});

// ── Refunds (workspace OWNER/ADMIN, payment verified on-chain) ──

export const refundsRouter = Router({ mergeParams: true });
refundsRouter.use(requireSession);

const refundSchema = z.object({
  amountDecimal: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
  reason: z.string().max(200).optional(),
});

refundsRouter.post<{ workspaceId: string; paymentId: string }>("/:paymentId/refund", async (req, res, next) => {
  try {
    if (!requireStripeConfigured(res)) return;
    await assertWorkspaceAccess.execute({
      workspaceId: req.params.workspaceId,
      userId: req.userId!,
      requiredRoles: ["OWNER", "ADMIN"],
    });
    await assertPaymentInWorkspace(req.params.paymentId, req.params.workspaceId);

    const body = refundSchema.parse(req.body ?? {});
    const created = await createRefund.execute({
      paymentId: req.params.paymentId,
      amountDecimal: body.amountDecimal,
      reason: body.reason,
      actorId: req.userId!,
    });

    auditBestEffort({
      workspaceId: req.params.workspaceId,
      actorId: req.userId!,
      action: "ADMIN_ACTION",
      resourceType: "Refund",
      resourceId: created.refundId,
      metadata: { paymentId: req.params.paymentId, status: created.status },
    });
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

// ── Reconciliation (PLATFORM_ADMIN only) ─────────────────

export const reconciliationRouter = Router();
reconciliationRouter.use(requireSession, requirePlatformAdmin);

reconciliationRouter.get("/", async (req, res, next) => {
  try {
    const query = z
      .object({
        workspaceId: z.string().uuid(),
        days: z.coerce.number().int().min(1).max(365).default(30),
      })
      .parse(req.query);

    const report = await reconcilePayments.execute({
      workspaceId: query.workspaceId,
      days: query.days,
    });

    auditBestEffort({
      workspaceId: null,
      actorId: req.userId!,
      action: "ADMIN_ACTION",
      resourceType: "ReconciliationReport",
      resourceId: null,
      metadata: { ...query, exceptions: report.exceptions.length },
    });
    res.json(report);
  } catch (err) {
    next(err);
  }
});




