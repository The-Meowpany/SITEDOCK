import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { DomainError } from "./errors";

const ENCRYPTED_PREFIX = "enc:v1:";
const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;

function parseKey(raw: string): Buffer {
  const value = raw.trim();
  if (!value) {
    throw new DomainError("SITEDOCK_SECRETS_KEY is empty", "INVALID_SECRETS_KEY");
  }

  let key: Buffer;
  if (/^[0-9a-fA-F]{64}$/.test(value)) {
    key = Buffer.from(value, "hex");
  } else {
    key = Buffer.from(value, "base64");
  }

  if (key.length !== KEY_BYTES) {
    throw new DomainError(
      "SITEDOCK_SECRETS_KEY must be 32 bytes encoded as base64 or 64 hexadecimal characters",
      "INVALID_SECRETS_KEY"
    );
  }

  return key;
}

/**
 * Encrypts service secrets at rest with AES-256-GCM. The ciphertext format is
 * versioned so the key can be rotated without ambiguity:
 * `enc:v1:<iv>:<authTag>:<ciphertext>` (base64url segments).
 */
export class SecretCipher {
  private readonly key: Buffer;

  constructor(key: Buffer | string) {
    if (Buffer.isBuffer(key)) {
      if (key.length !== KEY_BYTES) {
        throw new DomainError("Secret key must be 32 bytes", "INVALID_SECRETS_KEY");
      }
      this.key = Buffer.from(key);
      return;
    }
    this.key = parseKey(key);
  }

  static fromEnv(env: NodeJS.ProcessEnv): SecretCipher | null {
    const raw = env.SITEDOCK_SECRETS_KEY;
    if (!raw) return null;
    return new SecretCipher(raw);
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${ENCRYPTED_PREFIX}${iv.toString("base64url")}:${tag.toString("base64url")}:${ciphertext.toString("base64url")}`;
  }

  decrypt(payload: string): string {
    if (!SecretCipher.isEncrypted(payload)) {
      throw new DomainError("Secret value is not encrypted", "INVALID_SECRET_PAYLOAD");
    }

    const [ivPart, tagPart, ciphertextPart] = payload.slice(ENCRYPTED_PREFIX.length).split(":");
    if (!ivPart || !tagPart || ciphertextPart === undefined) {
      throw new DomainError("Secret payload is malformed", "INVALID_SECRET_PAYLOAD");
    }

    try {
      const decipher = createDecipheriv(ALGORITHM, this.key, Buffer.from(ivPart, "base64url"));
      decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
      return Buffer.concat([
        decipher.update(Buffer.from(ciphertextPart, "base64url")),
        decipher.final(),
      ]).toString("utf8");
    } catch {
      throw new DomainError("Secret payload could not be decrypted", "INVALID_SECRET_PAYLOAD");
    }
  }

  static isEncrypted(value: unknown): value is string {
    return typeof value === "string" && value.startsWith(ENCRYPTED_PREFIX);
  }
}
