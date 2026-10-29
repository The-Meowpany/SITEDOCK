import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  exchangeCodeForToken,
  fetchRepositories,
  generateJwt,
  initiateInstall,
  parseInstallationToken,
  verifyWebhookSignature,
} from "@sitedock/github";

const SECRET = "test-webhook-secret";
const PAYLOAD = Buffer.from('{"ref":"refs/heads/main","after":"abc"}', "utf8");

function sign(secret: string, payload: Buffer): string {
  return `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`;
}

describe("GitHub module public interface", () => {
  it("exposes callable installation, repository and signing interfaces", () => {
    expect(typeof initiateInstall).toBe("function");
    expect(typeof exchangeCodeForToken).toBe("function");
    expect(typeof parseInstallationToken).toBe("function");
    expect(typeof fetchRepositories).toBe("function");
    expect(typeof generateJwt).toBe("function");
    expect(typeof verifyWebhookSignature).toBe("function");
  });

  it("builds an install URL containing the redirect and a state nonce", () => {
    const url = new URL(initiateInstall());
    expect(url.origin + url.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(url.searchParams.get("state")).toBeTruthy();
    expect(url.searchParams.get("redirect_uri")).toBeTruthy();
  });

  it("parses the installation token format", () => {
    expect(parseInstallationToken("123:456:ghs_token")).toEqual({
      installationId: "123",
      appId: "456",
      token: "ghs_token",
    });
    expect(() => parseInstallationToken("malformed")).toThrow(/Invalid installation token/);
  });
});

describe("webhook signature verification", () => {
  it("accepts a valid HMAC-SHA256 signature over the raw body", () => {
    expect(verifyWebhookSignature(SECRET, PAYLOAD, sign(SECRET, PAYLOAD))).toBe(true);
  });

  it("rejects a signature made with a different secret", () => {
    expect(verifyWebhookSignature(SECRET, PAYLOAD, sign("other-secret", PAYLOAD))).toBe(false);
  });

  it("rejects tampered payloads", () => {
    const signature = sign(SECRET, PAYLOAD);
    expect(verifyWebhookSignature(SECRET, Buffer.from('{"ref":"refs/heads/evil"}'), signature)).toBe(false);
  });

  it("rejects malformed or missing signatures and empty secrets", () => {
    expect(verifyWebhookSignature(SECRET, PAYLOAD, "abc")).toBe(false);
    expect(verifyWebhookSignature(SECRET, PAYLOAD, "sha256=zzzz")).toBe(false);
    expect(verifyWebhookSignature("", PAYLOAD, sign(SECRET, PAYLOAD))).toBe(false);
  });
});

describe("GitHub App JWT", () => {
  const originalKey = process.env.GITHUB_APP_PRIVATE_KEY;

  afterEach(() => {
    if (originalKey === undefined) delete process.env.GITHUB_APP_PRIVATE_KEY;
    else process.env.GITHUB_APP_PRIVATE_KEY = originalKey;
  });

  it("refuses to emit an unsigned placeholder when no private key is configured", () => {
    delete process.env.GITHUB_APP_PRIVATE_KEY;
    expect(() => generateJwt("github", "123")).toThrow(/GITHUB_APP_PRIVATE_KEY/);
  });
});

describe("repository listing", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("maps the GitHub installation response to typed summaries", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          repositories: [
            { id: 1, name: "app", full_name: "acme/app", private: true },
          ],
        }),
      }))
    );

    await expect(fetchRepositories("42", "ghs_token")).resolves.toEqual([
      { id: "1", name: "app", fullName: "acme/app", private: true },
    ]);
  });
});
