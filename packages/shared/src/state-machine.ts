import { InvalidStateTransitionError } from "./errors";

/**
 * Centralizes valid state transitions for a given aggregate so business rules
 * are never expressed as scattered if/else across the codebase.
 *
 * Usage:
 *   const websiteTransitions = new StateMachine<WebsiteStatus>("Website", {
 *     DRAFT: ["PREVIEW"],
 *     PREVIEW: ["PENDING_APPROVAL"],
 *     ...
 *   });
 *   websiteTransitions.assertCanTransition(current, next);
 */
export class StateMachine<TState extends string> {
  constructor(
    private readonly entityName: string,
    private readonly transitions: Record<TState, readonly TState[]>
  ) {}

  canTransition(from: TState, to: TState): boolean {
    return this.transitions[from]?.includes(to) ?? false;
  }

  assertCanTransition(from: TState, to: TState): void {
    if (!this.canTransition(from, to)) {
      throw new InvalidStateTransitionError(this.entityName, from, to);
    }
  }
}
