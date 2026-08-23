import { StateMachine } from "@sitedock/shared";

export type WorkspaceInvitationStatus = "PENDING" | "ACCEPTED" | "EXPIRED" | "REVOKED";

/** An invitation is a small aggregate of its own — its lifecycle is independent
 * from the target user ever having an account (docs/ARCHITECTURE.md §4 "invite client"). */
export const workspaceInvitationStateMachine = new StateMachine<WorkspaceInvitationStatus>("WorkspaceInvitation", {
  PENDING: ["ACCEPTED", "EXPIRED", "REVOKED"],
  ACCEPTED: [],
  EXPIRED: [],
  REVOKED: [],
});
