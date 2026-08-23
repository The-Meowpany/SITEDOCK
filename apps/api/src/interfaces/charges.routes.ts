import { Router } from "express";
import { z } from "zod";
import {
  CancelProjectChargeUseCase,
  CreateProjectChargeUseCase,
  ListProjectChargesUseCase,
  PrismaProjectChargeRepository,
} from "@sitedock/billing";
import { paymentProvider } from "../payment-provider";
import { assertWebsiteAccess } from "../middleware/access-control";
import { requireSession } from "../middleware/require-session";
import { auditBestEffort } from "../audit";

const charges = new PrismaProjectChargeRepository();
const createCharge = new CreateProjectChargeUseCase(charges, paymentProvider);
const listCharges = new ListProjectChargesUseCase(charges);
const cancelCharge = new CancelProjectChargeUseCase(charges);

type WebsiteScopedParams = { workspaceId: string; websiteId: string };
type ChargeParams = WebsiteScopedParams & { chargeId: string };

// Mounted at /api/v1/workspaces/:workspaceId/websites/:websiteId/charges
export const chargesRouter = Router({ mergeParams: true });
chargesRouter.use(requireSession);

const createChargeSchema = z.object({
  title: z.string().min(3).max(140),
  priceDecimal: z.string().regex(/^\d+(\.\d{1,2})?$/),
  currency: z.string().length(3).default("USD"),
});

chargesRouter.get<WebsiteScopedParams>("/", async (req, res, next) => {
  try {
    await assertWebsiteAccess({
      workspaceId: req.params.workspaceId,
      userId: req.userId!,
      websiteId: req.params.websiteId,
    });
    res.json(await listCharges.execute(req.params.websiteId));
  } catch (err) {
    next(err);
  }
});

/**
 * Staff-only: creates a PENDING one-time charge (e.g. the creation/deploy
 * project fee) and returns its checkout link. PAID is only ever set by the
 * verified charge.succeeded webhook.
 */
chargesRouter.post<WebsiteScopedParams>("/", async (req, res, next) => {
  try {
    await assertWebsiteAccess({
      workspaceId: req.params.workspaceId,
      userId: req.userId!,
      websiteId: req.params.websiteId,
      requiredRoles: ["OWNER", "ADMIN", "DEVELOPER"],
    });
    const body = createChargeSchema.parse(req.body);
    const result = await createCharge.execute({
      workspaceId: req.params.workspaceId,
      websiteId: req.params.websiteId,
      title: body.title,
      priceDecimal: body.priceDecimal,
      currency: body.currency,
      successUrl: "https://sitedock.demo/charge/success",
      cancelUrl: "https://sitedock.demo/charge/cancel",
    });
    auditBestEffort({
      workspaceId: req.params.workspaceId,
      actorId: req.userId!,
      action: "PROJECT_CHARGE_CREATED",
      resourceType: "ProjectCharge",
      resourceId: result.chargeId,
      metadata: { websiteId: req.params.websiteId },
    });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

chargesRouter.post<ChargeParams>("/:chargeId/cancel", async (req, res, next) => {
  try {
    await assertWebsiteAccess({
      workspaceId: req.params.workspaceId,
      userId: req.userId!,
      websiteId: req.params.websiteId,
      requiredRoles: ["OWNER", "ADMIN", "DEVELOPER"],
    });
    await cancelCharge.execute({ chargeId: req.params.chargeId, workspaceId: req.params.workspaceId });
    auditBestEffort({
      workspaceId: req.params.workspaceId,
      actorId: req.userId!,
      action: "PROJECT_CHARGE_CANCELED",
      resourceType: "ProjectCharge",
      resourceId: req.params.chargeId,
    });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});


