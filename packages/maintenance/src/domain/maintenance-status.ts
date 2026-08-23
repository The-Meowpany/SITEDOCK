import { StateMachine } from "@sitedock/shared";

export type MaintenanceStatus =
  | "OPEN"
  | "IN_PROGRESS"
  | "WAITING_CLIENT"
  | "PENDING_PAYMENT"
  | "PAID"
  | "COMPLETED"
  | "APPROVED"
  | "CANCELED";

/** docs/ARCHITECTURE.md §69 "Maintenance Domain". */
export const maintenanceStateMachine = new StateMachine<MaintenanceStatus>("MaintenanceRequest", {
  OPEN: ["IN_PROGRESS", "PENDING_PAYMENT", "CANCELED"],
  PENDING_PAYMENT: ["PAID", "CANCELED"],
  PAID: ["IN_PROGRESS", "CANCELED"],
  IN_PROGRESS: ["WAITING_CLIENT", "COMPLETED", "CANCELED"],
  WAITING_CLIENT: ["IN_PROGRESS", "CANCELED"],
  COMPLETED: ["APPROVED", "IN_PROGRESS"], // IN_PROGRESS = client rejected, sent back for rework
  APPROVED: [],
  CANCELED: [],
});
