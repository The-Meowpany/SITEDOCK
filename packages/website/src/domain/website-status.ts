import { StateMachine } from "@sitedock/shared";

export type WebsiteStatus =
  | "DRAFT"
  | "PREVIEW"
  | "PENDING_APPROVAL"
  | "APPROVED"
  | "LIVE"
  | "PAST_DUE"
  | "GRACE_PERIOD"
  | "SUSPENDED"
  | "ARCHIVED"
  | "DELETED";

/**
 * Centralized transition table for the Website lifecycle (docs/ARCHITECTURE.md §4 /
 * §12). No transition happens anywhere in the codebase without going through this.
 */
export const websiteStateMachine = new StateMachine<WebsiteStatus>("Website", {
  DRAFT: ["PREVIEW", "ARCHIVED"],
  PREVIEW: ["PENDING_APPROVAL", "ARCHIVED"],
  PENDING_APPROVAL: ["APPROVED", "PREVIEW", "ARCHIVED"],
  APPROVED: ["LIVE", "ARCHIVED"],
  LIVE: ["PAST_DUE", "ARCHIVED"],
  PAST_DUE: ["GRACE_PERIOD", "LIVE"], // LIVE = payment recovered before grace period
  GRACE_PERIOD: ["SUSPENDED", "LIVE"], // LIVE = payment recovered during grace period
  SUSPENDED: ["LIVE", "ARCHIVED"], // LIVE = payment recovered after suspension
  ARCHIVED: ["DELETED"],
  DELETED: [],
});
