import { StateMachine } from "@sitedock/shared";

export type ServiceType = "WEB" | "API" | "WORKER" | "DATABASE" | "STORAGE" | "CRON";

export type ServiceStatus =
  | "PENDING"
  | "BUILDING"
  | "READY"
  | "DEPLOYING"
  | "LIVE"
  | "FAILED"
  | "STOPPED"
  | "SUPERSEDED";

/**
 * Centralized transition table for Service lifecycle.
 *
 * Lifecycle:
 *   PENDING → BUILDING → DEPLOYING → LIVE → SUPERSEDED
 *
 * Terminal/recovery states: FAILED, STOPPED.
 *
 * A failed deployment can be retried (BUILDING → ...), and a live service can
 * be stopped and restarted.
 */
export const serviceStateMachine = new StateMachine<ServiceStatus>("Service", {
  // PENDING → FAILED is required: a service whose very first build fails never
  // reaches BUILDING, and leaving it PENDING would hide the failure from the
  // customer and from every status filter.
  PENDING: ["BUILDING", "FAILED", "STOPPED"],
  BUILDING: ["READY", "DEPLOYING", "FAILED", "STOPPED"],
  READY: ["DEPLOYING", "FAILED", "STOPPED"],
  DEPLOYING: ["LIVE", "FAILED", "STOPPED"],
  LIVE: ["SUPERSEDED", "STOPPED", "BUILDING", "DEPLOYING"],
  SUPERSEDED: ["DEPLOYING", "BUILDING"],
  FAILED: ["BUILDING"],
  STOPPED: ["BUILDING"],
} as unknown as Record<ServiceStatus, readonly ServiceStatus[]>);