/**
 * Error taxonomy shared across bounded contexts.
 * Interfaces layer maps these to HTTP status codes — never leaks stack traces.
 */
export class DomainError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = "DomainError";
  }
}

export class ApplicationError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = "ApplicationError";
  }
}

export class InfrastructureError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = "InfrastructureError";
  }
}

export class NotFoundError extends ApplicationError {
  constructor(resource: string, id: string) {
    super(`${resource} ${id} not found`, "NOT_FOUND");
  }
}

export class UnauthorizedError extends ApplicationError {
  constructor(message = "Unauthorized") {
    super(message, "UNAUTHORIZED");
  }
}

export class ForbiddenError extends ApplicationError {
  constructor(message = "Forbidden") {
    super(message, "FORBIDDEN");
  }
}

export class ConflictError extends ApplicationError {
  constructor(message: string) {
    super(message, "CONFLICT");
  }
}

export class InvalidStateTransitionError extends DomainError {
  constructor(entity: string, from: string, to: string) {
    super(`${entity} cannot transition from ${from} to ${to}`, "INVALID_STATE_TRANSITION");
  }
}
