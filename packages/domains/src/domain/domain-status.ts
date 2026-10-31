import { StateMachine } from "@sitedock/shared";

export type DomainVerificationStatus = "PENDING" | "VERIFYING" | "VERIFIED" | "FAILED";

/** docs/ARCHITECTURE.md §5 aggregate invariant: "a domain cannot be considered VERIFIED without valid proof of ownership". */
export const domainStateMachine = new StateMachine<DomainVerificationStatus>("Domain", {
  PENDING: ["VERIFYING"],
  VERIFYING: ["VERIFIED", "FAILED"],
  FAILED: ["VERIFYING"],
  VERIFIED: [],
});
