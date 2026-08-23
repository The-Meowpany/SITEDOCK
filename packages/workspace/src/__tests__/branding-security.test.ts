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

// ── Safe values ──────────────────────────────────────────

describe("Branding validation — safe values", () => {
  it("accepts safe branding", () => {
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

  it("accepts valid HTTPS URLs and hex colors", () => {
    tryBranding({
      logoUrl: "https://cdn.example.com/logo.png",
      primaryColor: "#2e6b57",
    });
  });
});

// ── XSS / injection ─────────────────────────────────────

describe("Branding validation — XSS/injection rejection", () => {
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
    it(`rejects XSS: ${payload.slice(0, 40)}`, () => {
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

  it("rejects invalid colors", () => {
    expect(() => tryBranding({ primaryColor: "not-a-color" })).toThrow(/hex color/i);
  });

  it("accepts valid hex colors", () => {
    expect(() => tryBranding({ primaryColor: "#2e6b57" })).not.toThrow();
  });

  it("rejects nested objects as injection vectors", () => {
    expect(() => tryBranding({ nested: { inner: "payload" } })).toThrow(/nested object/i);
  });
});

// ── Prototype pollution (Fase 24) ────────────────────────

describe("Prototype pollution prevention", () => {
  it("rejects __proto__ arriving via JSON.parse (HTTP body)", () => {
    // JSON.parse SÍ crea __proto__ como propiedad propia (a diferencia del literal).
    const malicious = JSON.parse('{"__proto__": {"isAdmin": true}, "name": "safe"}');
    expect(() => tryBranding(malicious)).toThrow(DomainError);
  });

  it("rejects constructor as branding key", () => {
    const payload = JSON.parse('{"constructor": "exploit"}');
    expect(() => tryBranding(payload)).toThrow(DomainError);
  });

  it("rejects hasOwnProperty as branding key", () => {
    expect(() => tryBranding({ hasOwnProperty: true })).toThrow(DomainError);
  });

  it("does not pollute Object.prototype after storing branding", () => {
    tryBranding({ safeKey: "safeValue" });
    expect(({} as Record<string, unknown>).isAdmin).toBeUndefined();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

// ── Structural attacks ───────────────────────────────────

describe("Branding structural attacks", () => {
  it("rejects oversized string values", () => {
    expect(() => tryBranding({ tagline: "x".repeat(501) })).toThrow(/exceeds/i);
  });

  it("rejects too many keys", () => {
    const huge: Record<string, unknown> = {};
    for (let i = 0; i < 21; i++) huge[`key${i}`] = `v${i}`;
    expect(() => tryBranding(huge)).toThrow(/exceeds.*keys/i);
  });

  it("rejects invalid key names", () => {
    expect(() => tryBranding({ "bad key with spaces": "value" })).toThrow(/Invalid branding key/i);
    expect(() => tryBranding({ "": "value" })).toThrow(/Invalid branding key/i);
  });
});
