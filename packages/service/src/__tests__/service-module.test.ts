import { describe, expect, it } from "vitest";
import { serviceModuleName } from "../index";

describe("service module", () => {
  it("exports the module name", () => {
    expect(serviceModuleName).toBe("@sitedock/service");
  });
});
