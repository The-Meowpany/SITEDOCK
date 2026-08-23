import { Money } from "@sitedock/shared";

export interface RevenueSplit {
  grossAmount: Money;
  platformFee: Money;
  developerShare: Money;
}

/**
 * Strategy interface for computing the platform's cut of a payment
 * (docs/ARCHITECTURE.md §8 "Revenue Share"). Never hardcode a flat 10% —
 * the fee can vary by developer, plan, country, currency, volume, or promotion,
 * so callers inject whichever PlatformFeePolicy applies.
 */
export interface PlatformFeePolicy {
  computeSplit(grossAmount: Money): RevenueSplit;
}

/** Simplest policy: a fixed percentage fee, e.g. 10%. */
export class FlatPercentageFeePolicy implements PlatformFeePolicy {
  constructor(private readonly feePercentage: number) {
    if (feePercentage < 0 || feePercentage > 100) {
      throw new RangeError("feePercentage must be between 0 and 100");
    }
  }

  computeSplit(grossAmount: Money): RevenueSplit {
    const platformFee = grossAmount.percentage(this.feePercentage);
    const developerShare = grossAmount.subtract(platformFee);
    return { grossAmount, platformFee, developerShare };
  }
}
