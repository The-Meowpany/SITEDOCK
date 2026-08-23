import { Router } from "express";
import { Money, NotFoundError } from "@sitedock/shared";
import type { MockPaymentProvider } from "@sitedock/billing";
import { demoSimulator, processWebhook, projectCharges, subscriptions } from "../billing-container";
import { config } from "../config";
import { publicDemoRateLimiter } from "../middleware/rate-limit";

/**
 * PUBLIC surface for the DEMO checkout page — the client-facing half of the
 * payment flow when no real provider is configured. Two hard rules:
 * 1. It vanishes entirely outside demo mode (fail closed).
 * 2. Paying runs the SAME verify→claim→process webhook pipeline as a real
 *    provider; there is no trust shortcut because MockPaymentProvider signs
 *    its own payloads.
 */
export const publicDemoRouter = Router();

publicDemoRouter.use(publicDemoRateLimiter);

/** Fail closed doble: fuera de modo demo O con provider real no hay simulación. */
function requireDemoSimulator(sessionId: string): MockPaymentProvider {
  if (!config.allowDemoEndpoints || !demoSimulator) {
    throw new NotFoundError("Checkout", sessionId);
  }
  return demoSimulator;
}

publicDemoRouter.get("/demo-checkout/:sessionId", async (req, res, next) => {
  try {
    const demo = requireDemoSimulator(req.params.sessionId);
    const session = demo.describeSession(req.params.sessionId);
    if (!session) throw new NotFoundError("Checkout", req.params.sessionId);

    let description = "Suscripción SiteDock";
    let alreadyPaid = false;

    if (session.kind === "ONE_TIME") {
      const charge = await projectCharges.findById(session.referenceId);
      description = charge?.title ?? "Cobro de proyecto";
      alreadyPaid = charge?.status === "PAID";
    } else {
      const subscription = await subscriptions.findById(session.referenceId as never);
      if (subscription) {
        description =
          subscription.billingInterval === "YEARLY"
            ? "Membresía anual SiteDock"
            : "Membresía mensual SiteDock";
        alreadyPaid = ["ACTIVE", "TRIALING"].includes(subscription.status);
      }
    }

    const amount = Money.fromCents(session.amountCents, session.currency);
    res.json({
      description,
      amountDecimal: amount.toDecimalString(),
      currency: amount.currency,
      alreadyPaid,
    });
  } catch (err) {
    next(err);
  }
});

publicDemoRouter.post("/demo-checkout/:sessionId/pay", async (req, res, next) => {
  try {
    const demo = requireDemoSimulator(req.params.sessionId);
    const session = demo.describeSession(req.params.sessionId);
    if (!session) throw new NotFoundError("Checkout", req.params.sessionId);

    const { rawBody, signature } =
      session.kind === "ONE_TIME"
        ? demo.simulateSuccessfulCharge(req.params.sessionId)
        : demo.simulateSuccessfulPayment(req.params.sessionId);

    const event = demo.verifyAndParseWebhook(rawBody, signature);
    await processWebhook.execute(demo.name, event, rawBody);

    res.json({ status: "PAID" });
  } catch (err) {
    next(err);
  }
});




