import { describe, expect, it } from "vitest";
import { WebsiteId } from "@sitedock/shared";
import { MaintenanceRequestRepository } from "../domain/ports";
import { GetMaintenanceAllowanceForWebsiteUseCase } from "../application/maintenance-allowance.use-case";

const WEBSITE = WebsiteId("11111111-1111-1111-1111-111111111111");

class FakeRequestRepository implements MaintenanceRequestRepository {
  constructor(private createdInPeriod = 0) {}
  async findByIdForWebsite() {
    return null;
  }
  async listByWebsite() {
    return [];
  }
  async countCreatedBetween() {
    return this.createdInPeriod;
  }
  async save() {}
}

const PERIOD = { periodStart: new Date("2026-08-01T00:00:00Z"), periodEnd: new Date("2026-09-01T00:00:00Z") };

describe("GetMaintenanceAllowanceForWebsiteUseCase", () => {
  it("counts usage against a finite quota and flags over-quota tiers", async () => {
    const useCase = new GetMaintenanceAllowanceForWebsiteUseCase(new FakeRequestRepository(3));

    const withinQuota = await useCase.execute({ websiteId: WEBSITE, quotaIncluded: 4, ...PERIOD });
    expect(withinQuota).toMatchObject({ quotaIncluded: 4, usedThisPeriod: 3, remaining: 1, overQuota: false });

    const exhausted = await useCase.execute({ websiteId: WEBSITE, quotaIncluded: 3, ...PERIOD });
    expect(exhausted).toMatchObject({ remaining: 0, overQuota: true });
  });

  it("never reports negative remaining even when usage somehow exceeds the quota", async () => {
    const useCase = new GetMaintenanceAllowanceForWebsiteUseCase(new FakeRequestRepository(9));
    const allowance = await useCase.execute({ websiteId: WEBSITE, quotaIncluded: 4, ...PERIOD });
    expect(allowance.remaining).toBe(0);
    expect(allowance.overQuota).toBe(true);
  });

  it("treats NULL quota as unlimited — never over quota", async () => {
    const useCase = new GetMaintenanceAllowanceForWebsiteUseCase(new FakeRequestRepository(50));
    const unlimited = await useCase.execute({ websiteId: WEBSITE, quotaIncluded: null, ...PERIOD });
    expect(unlimited).toMatchObject({ quotaIncluded: null, remaining: null, overQuota: false, usedThisPeriod: 50 });
  });
});
