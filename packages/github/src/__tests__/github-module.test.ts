import { describe, expect, it } from "vitest";
import { verifyWebhookSignature } from "../github-auth.service";
import { GitHubRepositoryConnection } from "../github-repository-connection.entity";
import { createHmac } from "node:crypto";

describe("github webhook signature verification", () => {
  const secret = "test-webhook-secret";
  const payload = Buffer.from('{"ref":"refs/heads/main"}');

  it("verifies a valid HMAC-SHA256 signature", () => {
    const signature = "sha256=" + createHmac("sha256", secret).update(payload).digest("hex");
    expect(verifyWebhookSignature(secret, payload, signature)).toBe(true);
  });

  it("rejects a missing signature", () => {
    expect(verifyWebhookSignature(secret, payload, "")).toBe(false);
  });

  it("rejects a signature without the sha256= prefix", () => {
    expect(verifyWebhookSignature(secret, payload, "abc123")).toBe(false);
  });

  it("rejects when the secret is empty", () => {
    expect(verifyWebhookSignature("", payload, "sha256=deadbeef")).toBe(false);
  });

  it("rejects a tampered payload", () => {
    const signature = "sha256=" + createHmac("sha256", secret).update(payload).digest("hex");
    const tampered = Buffer.from('{"ref":"refs/heads/evil"}');
    expect(verifyWebhookSignature(secret, tampered, signature)).toBe(false);
  });

  it("rejects a wrong secret", () => {
    const signature = "sha256=" + createHmac("sha256", secret).update(payload).digest("hex");
    expect(verifyWebhookSignature("wrong-secret", payload, signature)).toBe(false);
  });
});

describe("GitHubRepositoryConnection", () => {
  const params = {
    organizationId: "org-1",
    installationId: "inst-1",
    repositoryId: "owner/repo",
    repositoryName: "repo",
    repositoryFullName: "owner/repo",
    defaultBranch: "main",
  };

  it("creates a connection with a random webhook secret and null pinned SHA", () => {
    const conn = GitHubRepositoryConnection.create(params);
    expect(conn.id).toBeDefined();
    expect(conn.organizationId).toBe("org-1");
    expect(conn.installationId).toBe("inst-1");
    expect(conn.repositoryId).toBe("owner/repo");
    expect(conn.repositoryName).toBe("repo");
    expect(conn.repositoryFullName).toBe("owner/repo");
    expect(conn.defaultBranch).toBe("main");
    expect(conn.pinnedCommitSha).toBeNull();
    expect(conn.webhookSecret).toBeDefined();
    expect(conn.webhookSecret.length).toBe(64); // 32 bytes hex = 64 chars
    expect(conn.createdAt).toBeInstanceOf(Date);
    expect(conn.updatedAt).toBeInstanceOf(Date);
    expect(conn.createdAt.getTime()).toBe(conn.updatedAt.getTime());
  });

  it("valid webhook signature passes validation", () => {
    const conn = GitHubRepositoryConnection.create(params);
    const payload = Buffer.from('{"ref":"refs/heads/main"}');
    const signature = "sha256=" + createHmac("sha256", conn.webhookSecret).update(payload).digest("hex");
    expect(conn.validateWebhookSignature(payload, signature)).toBe(true);
  });

  it("tampered payload fails validation", () => {
    const conn = GitHubRepositoryConnection.create(params);
    const tampered = Buffer.from('{"ref":"refs/heads/evil"}');
    expect(conn.validateWebhookSignature(tampered, "sha256=deadbeef")).toBe(false);
  });

  it("pinCommitSha pins the SHA and cannot be re-pinned", () => {
    const conn = GitHubRepositoryConnection.create(params);
    expect(conn.pinnedCommitSha).toBeNull();

    conn.pinCommitSha("a".repeat(40));
    expect(conn.pinnedCommitSha).toBe("a".repeat(40));
    expect(conn.updatedAt.getTime()).toBeGreaterThanOrEqual(conn.createdAt.getTime());

    const err = () => conn.pinCommitSha("b".repeat(40));
    expect(err).toThrow();
    try {
      conn.pinCommitSha("b".repeat(40));
    } catch (e) {
      expect((e as { code: string }).code).toBe("COMMIT_ALREADY_PINNED");
    }
    expect(conn.pinnedCommitSha).toBe("a".repeat(40)); // unchanged after failed re-pin
  });
});
