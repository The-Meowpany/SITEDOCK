import { describe, it, expect, vi } from "vitest";
import { requireTrustedOrigin } from "../middleware/trusted-origin";

function run(method: string, origin?: string) {
  const mw = requireTrustedOrigin(["https://app.example.com/"]);
  const req: any = { method, headers: origin === undefined ? {} : { origin } };
  const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn() };
  const next = vi.fn();
  mw(req, res, next);
  return { res, next };
}

describe("requireTrustedOrigin (CSRF)", () => {
  it("allows safe methods from any origin", () => {
    expect(run("GET", "https://evil.test").next).toHaveBeenCalled();
  });
  it("allows mutating requests without Origin (server-to-server)", () => {
    expect(run("POST").next).toHaveBeenCalled();
  });
  it("allows mutating requests from a trusted origin", () => {
    expect(run("POST", "https://APP.example.com").next).toHaveBeenCalled();
  });
  it("rejects mutating requests from an untrusted origin", () => {
    const { res, next } = run("DELETE", "https://evil.test");
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });
});
