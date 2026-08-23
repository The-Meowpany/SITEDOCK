import { DomainError } from "./errors";

/**
 * Retry policy for background jobs and webhook processing
 * (docs/ARCHITECTURE.md §30 "Retries"). Never retries infinitely — after
 * `maxAttempts` the caller is expected to route the failure to a dead-letter
 * queue rather than ask this class to keep trying.
 */
export class RetryPolicy {
  private constructor(
    readonly maxAttempts: number,
    private readonly backoffMs: readonly number[]
  ) {}

  static create(params: { maxAttempts: number; backoffMs: readonly number[] }): RetryPolicy {
    if (params.maxAttempts < 1) {
      throw new DomainError("RetryPolicy maxAttempts must be at least 1", "INVALID_RETRY_POLICY");
    }
    return new RetryPolicy(params.maxAttempts, params.backoffMs);
  }

  /** e.g. 1m, 5m, 15m, 1h — matches docs/ARCHITECTURE.md §30 example schedule. */
  static default(): RetryPolicy {
    return RetryPolicy.create({ maxAttempts: 4, backoffMs: [60_000, 300_000, 900_000, 3_600_000] });
  }

  /** Delay in ms before the given attempt number (1-indexed). Returns 0 for the first attempt. */
  delayBeforeAttempt(attemptNumber: number): number {
    if (attemptNumber <= 1) return 0;
    const index = Math.min(attemptNumber - 2, this.backoffMs.length - 1);
    return this.backoffMs[index] ?? 0;
  }

  shouldRetry(attemptNumber: number): boolean {
    return attemptNumber < this.maxAttempts;
  }
}

/**
 * Backoff exponencial acotado con jitter (Fase 19 §18): nunca retry inmediato
 * en loop, nunca crecimiento sin techo. RNG inyectable para tests
 * deterministas. Devuelve SIEMPRE >= 1ms para que un sleep(0) no genere
 * retry-storms.
 */
export function exponentialBackoffWithJitter(
  attemptNumber: number,
  options: { baseMs?: number; maxMs?: number; rng?: () => number } = {}
): number {
  const baseMs = options.baseMs ?? 500;
  const maxMs = options.maxMs ?? 30_000;
  const rng = options.rng ?? Math.random;
  const exponential = Math.min(baseMs * 2 ** Math.max(0, attemptNumber - 1), maxMs);
  const jittered = Math.round(exponential / 2 + rng() * (exponential / 2));
  return Math.max(1, jittered);
}

export interface RetryResult<T> {
  succeeded: boolean;
  attempts: number;
  result?: T;
  error?: unknown;
}

/**
 * Runs `fn` under a RetryPolicy, sleeping the backoff delay between attempts.
 * Used by scheduled jobs (apps/worker) so retry/backoff logic is written and
 * tested once instead of re-implemented per job.
 */
export async function runWithRetry<T>(fn: () => Promise<T>, policy: RetryPolicy): Promise<RetryResult<T>> {
  let attempt = 1;
  let lastError: unknown;

  while (attempt <= policy.maxAttempts) {
    const delay = policy.delayBeforeAttempt(attempt);
    if (delay > 0) await sleep(delay);

    try {
      const result = await fn();
      return { succeeded: true, attempts: attempt, result };
    } catch (err) {
      lastError = err;
      if (!policy.shouldRetry(attempt)) break;
      attempt += 1;
    }
  }

  return { succeeded: false, attempts: attempt, error: lastError };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

