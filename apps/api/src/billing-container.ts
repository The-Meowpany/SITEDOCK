import {
  FlatPercentageFeePolicy,
  MockPaymentProvider,
  PrismaInvoiceRepository,
  PrismaPaymentRepository,
  PrismaProjectChargeRepository,
  PrismaReconciliationLedger,
  PrismaServicePlanRepository,
  PrismaSubscriptionRepository,
  PrismaWebhookEventStore,
  ProcessPaymentWebhookUseCase,
  ReconcileStripePaymentsUseCase,
  StripeConnectedAccountGateway,
  StripeHttpClient,
  StripePaymentProvider,
  StripeReconciliationSource,
  StripeRefundGateway,
} from "@sitedock/billing";
import { config } from "./config";
import { paymentProvider as mockProviderSingleton } from "./payment-provider";

/**
 * Phase 16 — factory for the origin of money (ADR-006). The pipeline
 * verify→claim→process is SINGLE; only the inbound adapter changes:
 *
 *   PAYMENT_PROVIDER=mock   → MockPaymentProvider (demo, sin credenciales)
 *   PAYMENT_PROVIDER=stripe → StripePaymentProvider + gateways reales
 */

const useStripe =
  process.env.PAYMENT_PROVIDER === "stripe" &&
  !!process.env.STRIPE_SECRET_KEY &&
  !!process.env.STRIPE_WEBHOOK_SECRET;

function buildStripe() {
  const client = new StripeHttpClient({
    secretKey: process.env.STRIPE_SECRET_KEY!,
    apiBase: process.env.STRIPE_API_BASE,
  });
  return {
    provider: new StripePaymentProvider({
      secretKey: process.env.STRIPE_SECRET_KEY!,
      webhookSecret: process.env.STRIPE_WEBHOOK_SECRET!,
      apiBase: process.env.STRIPE_API_BASE,
      fetchImpl: fetch,
    }),
    connectedAccounts: new StripeConnectedAccountGateway(client),
    refunds: new StripeRefundGateway(client),
    reconciliation: new StripeReconciliationSource(client),
  };
}

const stripe = useStripe ? buildStripe() : null;

export const paymentProvider = stripe ? stripe.provider : mockProviderSingleton;
export const refundGateway = stripe ? stripe.refunds : null;
export const connectedAccountGateway = stripe ? stripe.connectedAccounts : null;
export const reconciliationSource = stripe ? stripe.reconciliation : null;

/**
 * DEMO simulator — exists only when the active provider is the mock.
 * The /demo-payments and /public/demo-checkout routes require it (404 otherwise).
 */
export const demoSimulator: MockPaymentProvider | null = useStripe ? null : mockProviderSingleton;

// ── Shared persistence ──────────────────────────────────

export const subscriptions = new PrismaSubscriptionRepository();
export const plans = new PrismaServicePlanRepository();
export const webhookEvents = new PrismaWebhookEventStore();
export const invoicesRepo = new PrismaInvoiceRepository();
export const paymentsRepo = new PrismaPaymentRepository();
export const projectCharges = new PrismaProjectChargeRepository();
export const feePolicy = new FlatPercentageFeePolicy(config.platformFeePercentage);
export const reconciliationLedger = new PrismaReconciliationLedger();

// ── Single money pipeline ────────────────────────────────

export const processWebhook = new ProcessPaymentWebhookUseCase(
  subscriptions,
  webhookEvents,
  invoicesRepo,
  paymentsRepo,
  feePolicy,
  projectCharges
);

export const reconcilePayments = new ReconcileStripePaymentsUseCase(
  paymentsRepo,
  reconciliationSource ?? { async listBalanceTransactions() { return []; } },
  reconciliationLedger
);
