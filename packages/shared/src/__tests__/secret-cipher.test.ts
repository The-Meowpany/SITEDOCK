import { describe, expect, it } from "vitest";
import { DomainError } from "../errors";
import { SecretCipher } from "../secret-cipher";

const KEY = Buffer.alloc(32, 7);

describe("SecretCipher", () => {
  it("encrypts and decrypts values without exposing the plaintext", () => {
    const cipher = new SecretCipher(KEY);
    const encrypted = cipher.encrypt("postgres://user:pass@db/app");

    expect(encrypted).toMatch(/^enc:v1:/);
    expect(encrypted).not.toContain("postgres");
    expect(cipher.decrypt(encrypted)).toBe("postgres://user:pass@db/app");
  });

  it("uses a fresh IV for every encryption", () => {
    const cipher = new SecretCipher(KEY);
    expect(cipher.encrypt("same")).not.toBe(cipher.encrypt("same"));
  });

  it("accepts base64 and hexadecimal keys", () => {
    expect(() => new SecretCipher(KEY.toString("base64"))).not.toThrow();
    expect(() => new SecretCipher(KEY.toString("hex"))).not.toThrow();
  });

  it("rejects keys that are not exactly 32 bytes", () => {
    expect(() => new SecretCipher("short")).toThrow(DomainError);
    expect(() => new SecretCipher(Buffer.alloc(16))).toThrow(DomainError);
  });

  it("rejects tampered ciphertext", () => {
    const cipher = new SecretCipher(KEY);
    const encrypted = cipher.encrypt("secret");
    const tampered = `${encrypted.slice(0, -1)}A`;

    expect(() => cipher.decrypt(tampered)).toThrow(/could not be decrypted/);
  });

  it("rejects plaintext payloads", () => {
    const cipher = new SecretCipher(KEY);
    expect(() => cipher.decrypt("plain-text")).toThrow(/not encrypted/);
  });

  it("returns null when no key is configured", () => {
    expect(SecretCipher.fromEnv({})).toBeNull();
  });
});
