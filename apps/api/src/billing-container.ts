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
 * Fase 16 — fábrica del origen del dinero (ADR-006). El pipeline
 * verify→claim→process es ÚNICO; cambia solo el adapter de entrada:
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
 * Simulador DEMO — existe solo cuando el provider activo es el mock.
 * Las rutas /demo-payments y /public/demo-checkout lo exigen (404 si no).
 */
export const demoSimulator: MockPaymentProvider | null = useStripe ? null : mockProviderSingleton;

// ── Persistencia compartida ──────────────────────────────

export const subscriptions = new PrismaSubscriptionRepository();
export const plans = new PrismaServicePlanRepository();
export const webhookEvents = new PrismaWebhookEventStore();
export const invoicesRepo = new PrismaInvoiceRepository();
export const paymentsRepo = new PrismaPaymentRepository();
export const projectCharges = new PrismaProjectChargeRepository();
export const feePolicy = new FlatPercentageFeePolicy(config.platformFeePercentage);
export const reconciliationLedger = new PrismaReconciliationLedger();

// ── Pipeline único de dinero ─────────────────────────────

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
