import { describe, expect, it } from "vitest";
import { DomainError, InvalidStateTransitionError, Money, WebsiteId } from "@sitedock/shared";
import { MaintenanceRequest } from "../domain/maintenance-request.entity";
import { MaintenanceComment } from "../domain/ports";

const WEBSITE = WebsiteId("11111111-1111-1111-1111-111111111111");

function newRequest() {
  return MaintenanceRequest.create({ id: "req-1", websiteId: WEBSITE, title: "Cambiar horario", description: "El restaurante ahora cierra a las 23hs" });
}

describe("MaintenanceRequest — free support flow", () => {
  it("starts OPEN", () => {
    expect(newRequest().status).toBe("OPEN");
  });

  it("walks OPEN → IN_PROGRESS → COMPLETED → APPROVED", () => {
    const r = newRequest();
    r.start();
    expect(r.status).toBe("IN_PROGRESS");
    r.complete();
    expect(r.status).toBe("COMPLETED");
    r.approve();
    expect(r.status).toBe("APPROVED");
  });

  it("allows the client to request changes on completed work, sending it back", () => {
    const r = newRequest();
    r.start();
    r.complete();
    r.requestChanges();
    expect(r.status).toBe("IN_PROGRESS");
  });

  it("allows canceling from OPEN or IN_PROGRESS", () => {
    const r1 = newRequest();
    r1.cancel();
    expect(r1.status).toBe("CANCELED");

    const r2 = newRequest();
    r2.start();
    r2.cancel();
    expect(r2.status).toBe("CANCELED");
  });

  it("rejects approving a request that was never completed", () => {
    const r = newRequest();
    expect(() => r.approve()).toThrow(InvalidStateTransitionError);
  });

  it("cannot transition out of a terminal APPROVED/CANCELED state", () => {
    const r = newRequest();
    r.start();
    r.complete();
    r.approve();
    expect(() => r.start()).toThrow(InvalidStateTransitionError);
  });
});

describe("MaintenanceRequest — paid work flow ('Agregar nueva sección — US$50')", () => {
  it("walks OPEN → PENDING_PAYMENT → PAID → IN_PROGRESS → COMPLETED → APPROVED", () => {
    const r = newRequest();
    r.quotePrice(Money.fromCents(5000, "USD"));
    expect(r.status).toBe("PENDING_PAYMENT");
    expect(r.price?.toDecimalString()).toBe("50.00");

    r.markPaid();
    expect(r.status).toBe("PAID");

    r.start();
    expect(r.status).toBe("IN_PROGRESS");

    r.complete();
    r.approve();
    expect(r.status).toBe("APPROVED");
  });

  it("rejects starting paid work before payment is confirmed", () => {
    const r = newRequest();
    r.quotePrice(Money.fromCents(5000, "USD"));
    expect(() => r.start()).toThrow(InvalidStateTransitionError);
  });
});

describe("MaintenanceRequest validation", () => {
  it("rejects a title shorter than 3 characters", () => {
    expect(() => MaintenanceRequest.create({ id: "x", websiteId: WEBSITE, title: "ab", description: "x" })).toThrow(DomainError);
  });
});

describe("MaintenanceComment", () => {
  it("rejects an empty comment body", () => {
    expect(() =>
      MaintenanceComment.create({ id: "c1", maintenanceRequestId: "req-1", authorId: "user-1", body: "   " })
    ).toThrow(DomainError);
  });

  it("trims comment body", () => {
    const c = MaintenanceComment.create({ id: "c1", maintenanceRequestId: "req-1", authorId: "user-1", body: "  Listo, ya lo cambié  " });
    expect(c.body).toBe("Listo, ya lo cambié");
  });
});
