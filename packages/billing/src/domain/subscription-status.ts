import { StateMachine } from "@sitedock/shared";

export type SubscriptionStatus =
  | "INCOMPLETE"
  | "TRIALING"
  | "ACTIVE"
  | "PAST_DUE"
  | "GRACE_PERIOD"
  | "PAUSED"
  | "SUSPENDED"
  | "CANCELED"
  | "EXPIRED";

/**
 * docs/ARCHITECTURE.md §6/§12/§38 — Subscription lifecycle. CANCELED and EXPIRED
 * are terminal: reactivating a canceled subscription always means creating a new
 * Subscription aggregate, never resurrecting the old one.
 */
export const subscriptionStateMachine = new StateMachine<SubscriptionStatus>("Subscription", {
  INCOMPLETE: ["TRIALING", "ACTIVE", "CANCELED"],
  TRIALING: ["ACTIVE", "CANCELED", "EXPIRED"],
  ACTIVE: ["PAST_DUE", "PAUSED", "CANCELED"],
  PAST_DUE: ["ACTIVE", "GRACE_PERIOD", "CANCELED"],
  GRACE_PERIOD: ["ACTIVE", "SUSPENDED"],
  SUSPENDED: ["ACTIVE", "CANCELED"],
  PAUSED: ["ACTIVE", "CANCELED"],
  CANCELED: [],
  EXPIRED: [],
});
