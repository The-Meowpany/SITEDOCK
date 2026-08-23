import { StateMachine } from "@sitedock/shared";

export type DomainVerificationStatus = "PENDING" | "VERIFYING" | "VERIFIED" | "FAILED";

/** docs/ARCHITECTURE.md §5 aggregate invariant: "no puede considerarse VERIFIED sin una prueba válida de ownership". */
export const domainStateMachine = new StateMachine<DomainVerificationStatus>("Domain", {
  PENDING: ["VERIFYING"],
  VERIFYING: ["VERIFIED", "FAILED"],
  FAILED: ["VERIFYING"],
  VERIFIED: [],
});
