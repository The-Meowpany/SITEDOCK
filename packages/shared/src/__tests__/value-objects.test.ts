import { describe, expect, it } from "vitest";
import { Money, EmailAddress, DomainName } from "../value-objects";
import { StateMachine } from "../state-machine";
import { DomainError, InvalidStateTransitionError } from "../errors";

describe("Money", () => {
  it("stores integer cents and never floats", () => {
    const m = Money.fromCents(2999, "usd");
    expect(m.amountCents).toBe(2999);
    expect(m.currency).toBe("USD");
    expect(m.toDecimalString()).toBe("29.99");
  });

  it("parses decimal strings without float error", () => {
    const m = Money.fromDecimalString("29.99", "USD");
    expect(m.amountCents).toBe(2999);
  });

  it("parses whole amounts", () => {
    const m = Money.fromDecimalString("15", "USD");
    expect(m.amountCents).toBe(1500);
  });

  it("rejects non-integer cents", () => {
    expect(() => Money.fromCents(29.5, "USD")).toThrow(DomainError);
  });

  it("rejects negative amounts", () => {
    expect(() => Money.fromCents(-100, "USD")).toThrow(DomainError);
  });

  it("adds amounts of the same currency", () => {
    const a = Money.fromCents(1000, "USD");
    const b = Money.fromCents(500, "USD");
    expect(a.add(b).amountCents).toBe(1500);
  });

  it("rejects operations across currencies", () => {
    const a = Money.fromCents(1000, "USD");
    const b = Money.fromCents(500, "EUR");
    expect(() => a.add(b)).toThrow(DomainError);
  });

  it("computes platform fee percentage (revenue share)", () => {
    const price = Money.fromCents(2900, "USD"); // $29.00
    const fee = price.percentage(10);
    const developerShare = price.subtract(fee);
    expect(fee.amountCents).toBe(290);
    expect(developerShare.amountCents).toBe(2610); // $26.10
  });
});

describe("EmailAddress", () => {
  it("normalizes to lowercase and trims", () => {
    const email = EmailAddress.create("  Freelancer@Example.com ");
    expect(email.value).toBe("freelancer@example.com");
  });

  it("rejects invalid emails", () => {
    expect(() => EmailAddress.create("not-an-email")).toThrow(DomainError);
  });
});

describe("DomainName", () => {
  it("accepts a valid custom domain", () => {
    expect(DomainName.create("restauranteperez.com").value).toBe("restauranteperez.com");
  });

  it("normalizes to lowercase", () => {
    expect(DomainName.create("Restaurante-Perez.COM").value).toBe("restaurante-perez.com");
  });

  it("accepts subdomains", () => {
    expect(DomainName.create("app.restauranteperez.com").value).toBe("app.restauranteperez.com");
  });

  it("rejects a bare hostname without a TLD", () => {
    expect(() => DomainName.create("localhost")).toThrow(DomainError);
  });

  it("rejects a domain with a leading or trailing hyphen in a label", () => {
    expect(() => DomainName.create("-bad.com")).toThrow(DomainError);
  });

  it("rejects garbage input", () => {
    expect(() => DomainName.create("not a domain!!")).toThrow(DomainError);
  });
});

describe("StateMachine", () => {
  type WebsiteStatus = "DRAFT" | "PREVIEW" | "LIVE" | "SUSPENDED";

  const machine = new StateMachine<WebsiteStatus>("Website", {
    DRAFT: ["PREVIEW"],
    PREVIEW: ["LIVE"],
    LIVE: ["SUSPENDED"],
    SUSPENDED: ["LIVE"],
  });

  it("allows valid transitions", () => {
    expect(machine.canTransition("DRAFT", "PREVIEW")).toBe(true);
    expect(() => machine.assertCanTransition("LIVE", "SUSPENDED")).not.toThrow();
  });

  it("rejects invalid transitions", () => {
    expect(machine.canTransition("DRAFT", "LIVE")).toBe(false);
    expect(() => machine.assertCanTransition("DRAFT", "LIVE")).toThrow(InvalidStateTransitionError);
  });
});
