import { ServicePlanId, SubscriptionId, WebsiteId, WorkspaceId } from "@sitedock/shared";
import { ServicePlan, PlanKind } from "./service-plan.entity";
import { Subscription } from "./subscription.entity";
import { Invoice, Payment } from "./payment";
import { ProjectCharge } from "./project-charge.entity";

export interface ServicePlanRepository {
  findByIdInWorkspace(id: ServicePlanId, workspaceId: WorkspaceId): Promise<ServicePlan | null>;
  listByWorkspace(workspaceId: WorkspaceId): Promise<ServicePlan[]>;
  save(plan: ServicePlan): Promise<void>;
}

export interface SubscriptionRepository {
  findById(id: SubscriptionId): Promise<Subscription | null>;
  /** Legacy convenience — returns the HOSTING subscription when both kinds exist. */
  findByWebsiteId(websiteId: WebsiteId): Promise<Subscription | null>;
  findByWebsiteIdAndKind(websiteId: WebsiteId, kind: PlanKind): Promise<Subscription | null>;
  findByExternalId(provider: string, externalSubscriptionId: string): Promise<Subscription | null>;
  /**
   * Cross-tenant lookup by status — only legitimate from system-level scheduled
   * jobs (docs/ARCHITECTURE.md §31 "Scheduled Jobs"), never from a user-facing
   * request. User-facing code must always go through a workspace/website-scoped
   * method instead.
   */
  listByStatus(status: Subscription["status"]): Promise<Subscription[]>;
  save(subscription: Subscription): Promise<void>;
}

export interface InvoiceRepository {
  findById(id: string): Promise<Invoice | null>;
  findOpenBySubscription(subscriptionId: string): Promise<Invoice | null>;
  save(invoice: Invoice): Promise<void>;
}

export interface PaymentRepository {
  findById(id: string): Promise<Payment | null>;
  /** Resolución por referencia del provider — la usa refund/dispute webhooks. */
  findByExternalPaymentId(provider: string, externalPaymentId: string): Promise<Payment | null>;
  save(payment: Payment): Promise<void>;
}

// ── Fase 16 — movimientos de dinero reales ────────────────

export interface RefundRecord {
  id: string;
  paymentId: string;
  amountCents: number;
  currency: string;
  reason?: string | null;
  status: "PENDING" | "SUCCEEDED" | "FAILED";
  externalRefundId: string | null;
  createdAt: Date;
}

export interface RefundRepository {
  findByExternalRefundId(externalRefundId: string): Promise<RefundRecord | null>;
  save(refund: RefundRecord): Promise<void>;
}

export type DisputeStatus = "OPEN" | "WON" | "LOST";

export interface DisputeRecord {
  id: string;
  paymentId: string;
  externalDisputeId: string;
  amountCents: number;
  currency: string;
  status: DisputeStatus;
  evidenceDueBy?: string | null;
  createdAt: Date;
  closedAt?: Date | null;
}

export interface DisputeRepository {
  findByExternalDisputeId(externalDisputeId: string): Promise<DisputeRecord | null>;
  save(dispute: DisputeRecord): Promise<void>;
}

export interface ProjectChargeRepository {
  findById(id: string): Promise<ProjectCharge | null>;
  findByIdInWorkspace(id: string, workspaceId: WorkspaceId): Promise<ProjectCharge | null>;
  findByExternalCheckoutId(provider: string, externalCheckoutId: string): Promise<ProjectCharge | null>;
  listByWebsite(websiteId: WebsiteId): Promise<ProjectCharge[]>;
  save(charge: ProjectCharge): Promise<void>;
}

/**
 * Idempotency ledger for provider webhooks (docs/ARCHITECTURE.md §16/§76). A
 * unique constraint on (provider, externalEventId) at the infrastructure level
 * is what actually enforces this under concurrent deliveries.
 */export interface WebhookEventStore {
  /** Legacy existence check (admin introspection). */
  hasBeenProcessed(provider: string, externalEventId: string): Promise<boolean>;
  /**
   * Atomically CLAIMS an event before any mutation: returns true exactly once
   * per (provider, externalEventId), false when it was already claimed or
   * processed. Claiming FIRST (instead of recording after processing) closes
   * the crash window where a subscription was already mutated but the ledger
   * not yet written — a provider retry would otherwise double-apply.
   */
  claimEvent(provider: string, externalEventId: string, eventType: string, payloadHash: string): Promise<boolean>;
  /** Compensation: releases a claim whose processing FAILED, so the provider's retry can be handled cleanly. */
  releaseEvent(provider: string, externalEventId: string): Promise<void>;
  /** Flips a claimed event to its final PROCESSED state once handling succeeded. */
  recordProcessed(provider: string, externalEventId: string, eventType: string, payloadHash: string): Promise<void>;
}
