import { describe, expect, it } from "vitest";
import { InvalidStateTransitionError, WebsiteId, WorkspaceId, DomainError } from "@sitedock/shared";
import { Website } from "../domain/website.entity";

const WORKSPACE = WorkspaceId("11111111-1111-1111-1111-111111111111");

function newDraftWebsite() {
  return Website.create({ id: WebsiteId("22222222-2222-2222-2222-222222222222"), workspaceId: WORKSPACE, projectId: "proj-1", name: "Restaurante Pérez" });
}

describe("Website entity — creation", () => {
  it("starts in DRAFT with a generated subdomain", () => {
    const site = newDraftWebsite();
    expect(site.status).toBe("DRAFT");
    expect(site.subdomain).toMatch(/^restaurante-perez-22222222$/);
    expect(site.productionDeploymentId).toBeNull();
  });
});

describe("Website lifecycle — happy path", () => {
  it("walks DRAFT → PREVIEW → PENDING_APPROVAL → APPROVED → LIVE", () => {
    const site = newDraftWebsite();
    site.moveToPreview();
    expect(site.status).toBe("PREVIEW");

    site.submitForClientApproval();
    expect(site.status).toBe("PENDING_APPROVAL");

    site.approve();
    expect(site.status).toBe("APPROVED");

    site.publish("deploy-1", "READY");
    expect(site.status).toBe("LIVE");
    expect(site.productionDeploymentId).toBe("deploy-1");
  });

  it("supports client rejecting the approval, sending it back to PREVIEW", () => {
    const site = newDraftWebsite();
    site.moveToPreview();
    site.submitForClientApproval();
    site.rejectApproval();
    expect(site.status).toBe("PREVIEW");
  });
});

describe("Website — invariant: cannot go LIVE without a valid deployment", () => {
  it("rejects publish() with a non-READY deployment status", () => {
    const site = newDraftWebsite();
    site.moveToPreview();
    site.submitForClientApproval();
    site.approve();

    expect(() => site.publish("deploy-1", "BUILDING" as never)).toThrow(DomainError);
    expect(site.status).toBe("APPROVED"); // unchanged
  });

  it("rejects publish() before the website has been approved", () => {
    const site = newDraftWebsite();
    expect(() => site.publish("deploy-1", "READY")).toThrow(DomainError);
  });
});

describe("Website — invalid transitions are rejected", () => {
  it("cannot jump from DRAFT directly to LIVE via publish()", () => {
    const site = newDraftWebsite();
    expect(() => site.publish("deploy-1", "READY")).toThrow(DomainError);
    expect(site.status).toBe("DRAFT");
  });

  it("cannot suspend a website that was never LIVE", () => {
    const site = newDraftWebsite();
    expect(() => site.suspend()).toThrow(InvalidStateTransitionError);
  });
});

describe("Website — billing-driven suspension flow", () => {
  function liveWebsite() {
    const site = newDraftWebsite();
    site.moveToPreview();
    site.submitForClientApproval();
    site.approve();
    site.publish("deploy-1", "READY");
    return site;
  }

  it("walks LIVE → PAST_DUE → GRACE_PERIOD → SUSPENDED → LIVE (payment recovered)", () => {
    const site = liveWebsite();

    site.markPastDue();
    expect(site.status).toBe("PAST_DUE");

    site.markGracePeriod();
    expect(site.status).toBe("GRACE_PERIOD");

    site.suspend();
    expect(site.status).toBe("SUSPENDED");

    site.reactivate();
    expect(site.status).toBe("LIVE");
  });

  it("lets an operator suspend a LIVE or PAST_DUE website and reactivate it", () => {
    const live = liveWebsite();
    live.suspend();
    expect(live.status).toBe("SUSPENDED");
    live.reactivate();
    expect(live.status).toBe("LIVE");

    const overdue = liveWebsite();
    overdue.markPastDue();
    overdue.suspend();
    expect(overdue.status).toBe("SUSPENDED");
  });

  it("allows recovering directly from PAST_DUE without going through suspension", () => {
    const site = liveWebsite();
    site.markPastDue();
    site.reactivate();
    expect(site.status).toBe("LIVE");
  });

  it("allows rollback while LIVE or SUSPENDED, but not from DRAFT", () => {
    const live = liveWebsite();
    live.rollbackTo("deploy-0");
    expect(live.productionDeploymentId).toBe("deploy-0");

    const draft = newDraftWebsite();
    expect(() => draft.rollbackTo("deploy-0")).toThrow(DomainError);
  });

  it("allows archiving from LIVE", () => {
    const site = liveWebsite();
    site.archive();
    expect(site.status).toBe("ARCHIVED");
  });

  it("rejects reactivating an ARCHIVED website (no LIVE transition defined)", () => {
    const site = liveWebsite();
    site.archive();
    expect(() => site.reactivate()).toThrow(InvalidStateTransitionError);
  });
});

