import { describe, expect, it } from "vitest";
import { previewHostnameFor } from "../application/enqueue-preview-deployment.use-case";

const WEBSITE = "11111111-1111-1111-1111-111111111111";
const OTHER_WEBSITE = "22222222-2222-2222-2222-222222222222";

describe("previewHostnameFor", () => {
  it("produces a valid DNS label", () => {
    const hostname = previewHostnameFor(WEBSITE, "feature/Checkout-Redesign");
    expect(hostname).toMatch(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/);
    expect(hostname.length).toBeLessThanOrEqual(63);
  });

  it("is stable for the same branch and distinct across branches/tenants", () => {
    expect(previewHostnameFor(WEBSITE, "main")).toBe(previewHostnameFor(WEBSITE, "main"));
    expect(previewHostnameFor(WEBSITE, "main")).not.toBe(previewHostnameFor(WEBSITE, "develop"));
    expect(previewHostnameFor(WEBSITE, "main")).not.toBe(previewHostnameFor(OTHER_WEBSITE, "main"));
  });

  it("appends a collision suffix without exceeding the DNS limit", () => {
    const hostname = previewHostnameFor(WEBSITE, "x".repeat(200), "abc123");
    expect(hostname.endsWith("-abc123")).toBe(true);
    expect(hostname.length).toBeLessThanOrEqual(63);
  });
});
