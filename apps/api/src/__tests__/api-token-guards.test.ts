import { describe, expect, it } from "vitest";
import type { NextFunction, Request, Response } from "express";
import { apiTokenPathGuard, apiTokenScopeGuard } from "../middleware/api-token-auth";

function request(overrides: Partial<Request> & { apiToken?: Request["apiToken"] }) {
  return {
    method: "GET",
    path: "/workspaces/ws-1/websites",
    params: { workspaceId: "ws-1" },
    ...overrides,
  } as unknown as Request;
}

function run(middleware: (req: Request, res: Response, next: NextFunction) => void, req: Request) {
  let error: unknown;
  middleware(req, {} as Response, ((err?: unknown) => {
    error = err;
  }) as NextFunction);
  return error as Error | undefined;
}

const token = { id: "token-1", workspaceId: "ws-1", scopes: ["read", "write"] };

describe("API token path guard", () => {
  it("ignores cookie-authenticated requests", () => {
    expect(run(apiTokenPathGuard, request({}))).toBeUndefined();
  });

  it("allows the token's own workspace", () => {
    expect(run(apiTokenPathGuard, request({ apiToken: token }))).toBeUndefined();
  });

  it("allows GET /workspaces (the route filters to the token workspace)", () => {
    expect(
      run(apiTokenPathGuard, request({ apiToken: token, path: "/workspaces", params: {} }))
    ).toBeUndefined();
  });

  it("rejects another workspace", () => {
    const error = run(
      apiTokenPathGuard,
      request({
        apiToken: token,
        path: "/workspaces/ws-2/websites",
        params: { workspaceId: "ws-2" },
      })
    );
    expect(error?.message).toContain("own workspace");
  });

  it("rejects platform administration", () => {
    expect(
      run(apiTokenPathGuard, request({ apiToken: token, path: "/admin/users", params: {} }))?.message
    ).toContain("own workspace");
  });

  it("rejects creating workspaces", () => {
    expect(
      run(
        apiTokenPathGuard,
        request({ apiToken: token, method: "POST", path: "/workspaces", params: {} })
      )?.message
    ).toContain("own workspace");
  });
});

describe("API token scope guard", () => {
  it("requires read for GET", () => {
    expect(
      run(apiTokenScopeGuard, request({ apiToken: { ...token, scopes: ["write"] } }))?.message
    ).toContain("read");
  });

  it("requires write for mutations", () => {
    expect(
      run(
        apiTokenScopeGuard,
        request({ apiToken: { ...token, scopes: ["read"] }, method: "POST" })
      )?.message
    ).toContain("write");
  });

  it("rejects a mismatched workspace", () => {
    expect(
      run(
        apiTokenScopeGuard,
        request({
          apiToken: token,
          params: { workspaceId: "ws-2" },
          path: "/workspaces/ws-2/websites",
        })
      )?.message
    ).toContain("different workspace");
  });

  it("allows a read token to read and a write token to mutate", () => {
    expect(
      run(apiTokenScopeGuard, request({ apiToken: { ...token, scopes: ["read"] } }))
    ).toBeUndefined();
    expect(
      run(
        apiTokenScopeGuard,
        request({ apiToken: token, method: "POST" })
      )
    ).toBeUndefined();
  });
});
