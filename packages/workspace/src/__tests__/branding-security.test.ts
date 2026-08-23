import { describe, expect, it, beforeEach } from "vitest";
import { DomainError, UserId, WorkspaceId } from "@sitedock/shared";
import { Workspace } from "../domain/workspace.entity";

const OWNER = UserId("11111111-1111-1111-1111-111111111111");

let ws: Workspace;

beforeEach(() => {
  ws = Workspace.create({
    id: WorkspaceId("22222222-2222-2222-2222-222222222222"),
    name: "Test WS",
    ownerId: OWNER,
  });
});

function tryBranding(branding: Record<string, unknown> | null) {
  ws.updateBranding(branding);
}

describe("Branding validation (Fase 21 §6/§8)", () => {
  it("accepts safe branding values", () => {
    tryBranding({
      name: "Studio XYZ",
      primaryColor: "#2e6b57",
      logoUrl: "https://cdn.studioxyz.com/logo.png",
    });
    expect(ws.branding).toEqual({
      name: "Studio XYZ",
      primaryColor: "#2e6b57",
      logoUrl: "https://cdn.studioxyz.com/logo.png",
    });
  });

  it("accepts null to reset branding", () => {
    tryBranding({ name: "test" });
    tryBranding(null);
    expect(ws.branding).toBeNull();
  });

  const xssPayloads = [
    '<script>alert("xss")</script>',
    "<img onerror=alert(1) src=x>",
    "javascript:alert(document.cookie)",
    "data:text/html;base64,PHNjcmlwdD4=",
    "<svg onload=alert(1)>",
    '<iframe src="javascript:alert(1)">',
    '<object data="data:text/html,<script>">',
    '"><script>alert(1)</script>',
  ];

  for (const payload of xssPayloads) {
    it(`rejects XSS in value: ${payload.slice(0, 40)}`, () => {
      expect(() => tryBranding({ tagline: payload })).toThrow(DomainError);
      expect(() => tryBranding({ name: payload })).toThrow(DomainError);
    });
  }

  it("rejects event handler injection", () => {
    expect(() => tryBranding({ tagline: "Click onclick=alert(1)" })).toThrow(/unsafe content/i);
  });

  it("rejects non-HTTPS logo URLs", () => {
    expect(() => tryBranding({ logoUrl: "http://cdn.example.com/logo.png" })).toThrow(/https/);
    expect(() => tryBranding({ logoUrl: "javascript:void(0)" })).toThrow();
  });

  it("accepts valid HTTPS logo URLs", () => {
    expect(() => tryBranding({ logoUrl: "https://cdn.example.com/logo.png" })).not.toThrow();
  });

  it("rejects invalid colors and accepts valid hex", () => {
    expect(() => tryBranding({ primaryColor: "not-a-color" })).toThrow(/hex color/i);
    expect(() => tryBranding({ primaryColor: "#2e6b57" })).not.toThrow();
  });

  it("rejects nested objects as injection vectors", () => {
    expect(() => tryBranding({ nested: { inner: "payload" } })).toThrow(/nested object/i);
  });

  it("rejects oversized values", () => {
    expect(() => tryBranding({ tagline: "x".repeat(501) })).toThrow(/exceeds/i);
  });

  it("rejects too many keys", () => {
    const huge: Record<string, unknown> = {};
    for (let i = 0; i < 21; i++) huge[`key${i}`] = `v${i}`;
    expect(() => tryBranding(huge)).toThrow(/exceeds.*keys/i);
  });

  it("rejects invalid key names", () => {
    expect(() => tryBranding({ "bad key": "value" })).toThrow(/Invalid branding key/i);
    expect(() => tryBranding({ "": "value" })).toThrow(/Invalid branding key/i);
  });
});
