/**
 * Provider metrics (Phase 19 §17): in-process counters, no dependencies.
 * Enough for the /admin/metrics endpoint and for tests. An external collector
 * (Prometheus/OTel) can replace the sink without touching the callers.
 */

export type ProviderOutcome = "success" | "failure" | "timeout" | "rate_limited";

export interface ProviderMetricEvent {
  provider: string;
  operation: string;
  outcome: ProviderOutcome;
  durationMs?: number;
}

export interface ProviderMetricSnapshot {
  key: string;
  provider: string;
  operation: string;
  total: number;
  success: number;
  failure: number;
  timeout: number;
  rateLimited: number;
  totalDurationMs: number;
}

class ProviderMetricsRegistry {
  private entries = new Map<string, ProviderMetricSnapshot>();

  record(event: ProviderMetricEvent): void {
    const key = `${event.provider}:${event.operation}`;
    const entry =
      this.entries.get(key) ??
      ({
        key,
        provider: event.provider,
        operation: event.operation,
        total: 0,
        success: 0,
        failure: 0,
        timeout: 0,
        rateLimited: 0,
        totalDurationMs: 0,
      } satisfies ProviderMetricSnapshot);

    entry.total++;
    entry[event.outcome === "rate_limited" ? "rateLimited" : event.outcome]++;
    entry.totalDurationMs += Math.max(0, event.durationMs ?? 0);
    this.entries.set(key, entry);
  }

  snapshot(): ProviderMetricSnapshot[] {
    return [...this.entries.values()].sort((a, b) => a.key.localeCompare(b.key));
  }

  reset(): void {
    this.entries.clear();
  }
}

/** Process-wide singleton — adapters import it directly. */
export const providerMetrics = new ProviderMetricsRegistry();

/** Wraps a provider operation, recording its outcome and latency. */
export async function withProviderMetrics<T>(
  event: Omit<ProviderMetricEvent, "outcome" | "durationMs">,
  fn: () => Promise<T>
): Promise<T> {
  const startedAt = Date.now();
  try {
    const result = await fn();
    providerMetrics.record({ ...event, outcome: "success", durationMs: Date.now() - startedAt });
    return result;
  } catch (err) {
    const outcome: ProviderOutcome =
      (err as { name?: string }).name === "StripeRateLimitError" ? "rate_limited" : "failure";
    providerMetrics.record({ ...event, outcome, durationMs: Date.now() - startedAt });
    throw err;
  }
}

