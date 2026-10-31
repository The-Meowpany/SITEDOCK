import { describe, it, expect, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";
import { requireTrustedOrigin } from "../middleware/trusted-origin";

function run(method: string, origin?: string) {
  const middleware = requireTrustedOrigin(["https://app.example.com/"]);
  const req = { method, headers: origin === undefined ? {} : { origin } } as unknown as Request;
  const status = vi.fn().mockReturnThis();
  const json = vi.fn();
  const res = { status, json } as unknown as Response;
  const next = vi.fn();
  middleware(req, res, next as unknown as NextFunction);
  return { status, json, next };
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
    const { status, next } = run("DELETE", "https://evil.test");
    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(403);
  });
});
