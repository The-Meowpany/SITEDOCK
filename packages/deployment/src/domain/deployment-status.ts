import { StateMachine } from "@sitedock/shared";

export type DeploymentStatus = "QUEUED" | "BUILDING" | "READY" | "PUBLISHED" | "FAILED" | "CANCELED";

/** docs/ARCHITECTURE.md §12 — Deployment state machine. */
export const deploymentStateMachine = new StateMachine<DeploymentStatus>("Deployment", {
  QUEUED: ["BUILDING", "CANCELED"],
  BUILDING: ["READY", "FAILED"],
  READY: ["PUBLISHED"],
  PUBLISHED: [],
  FAILED: [],
  CANCELED: [],
});
