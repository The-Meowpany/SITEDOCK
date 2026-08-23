import { WebsiteId } from "@sitedock/shared";
import { MaintenanceRequestRepository } from "../domain/ports";

export interface MaintenanceAllowance {
  /** NULL quota = unlimited requests while the membership is active. */
  quotaIncluded: number | null;
  usedThisPeriod: number;
  remaining: number | null;
  overQuota: boolean;
  periodStart: Date;
  periodEnd: Date;
}

/**
 * Pure tier math: how many of the included modification requests a website has
 * consumed inside the CURRENT billing period of its MAINTENANCE membership
 * (period derived from the subscription's nextBillingDate — the same interval
 * arithmetic the Subscription aggregate uses, mirrored here read-only).
 *
 * Cross-context by design: the CALLER (API layer) resolves the MAINTENANCE
 * subscription and plan quota via Billing; this use case only owns request
 * counting and the covered/over-quota verdict.
 */
export class GetMaintenanceAllowanceForWebsiteUseCase {
  constructor(private readonly requests: MaintenanceRequestRepository) {}

  async execute(params: {
    websiteId: string;
    quotaIncluded: number | null;
    periodStart: Date;
    periodEnd: Date;
    now?: Date;
  }): Promise<MaintenanceAllowance> {
    const now = params.now ?? new Date();
    const used = await this.requests.countCreatedBetween(
      WebsiteId(params.websiteId),
      params.periodStart,
      params.periodEnd > now ? params.periodEnd : now
    );

    const unlimited = params.quotaIncluded === null;
    return {
      quotaIncluded: unlimited ? null : params.quotaIncluded!,
      usedThisPeriod: used,
      remaining: unlimited ? null : Math.max(0, params.quotaIncluded! - used),
      // A negative-quota edge can't exist (validated at plan creation); the
      // comparison is what makes "0 included" tiers behave as all-quoted.
      overQuota: !unlimited && used >= params.quotaIncluded!,
      periodStart: params.periodStart,
      periodEnd: params.periodEnd,
    };
  }
}
