import { StateMachine } from "@sitedock/shared";

export type ServiceDeploymentStatus = "QUEUED" | "BUILDING" | "READY" | "FAILED" | "CANCELED";

export const serviceDeploymentStateMachine = new StateMachine<ServiceDeploymentStatus>("ServiceDeployment", {
  QUEUED: ["BUILDING", "FAILED", "CANCELED"],
  BUILDING: ["READY", "FAILED", "CANCELED"],
  READY: ["FAILED"],
  FAILED: [],
  CANCELED: [],
});
