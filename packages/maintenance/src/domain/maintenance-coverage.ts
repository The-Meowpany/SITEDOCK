export function isWithinIncludedMaintenanceQuota(
  quotaIncluded: number | null,
  usedIncludingRequest: number
): boolean {
  return quotaIncluded === null || usedIncludingRequest <= quotaIncluded;
}
