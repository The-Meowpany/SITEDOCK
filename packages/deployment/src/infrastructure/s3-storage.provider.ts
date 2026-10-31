import { createHash, createHmac } from "node:crypto";
import { InfrastructureError, withProviderMetrics } from "@sitedock/shared";
import { StorageProvider } from "../domain/ports";

export interface S3StorageProviderConfig {
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Endpoint base — override para MinIO/tests. Default: AWS virtual-hosted. */
  endpoint?: string;
  fetchImpl?: typeof fetch;
}

const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

function sha256Hex(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

/**
 * REAL StorageProvider over the S3 REST API with SigV4 signing implemented
 * locally (ADR-003/006: no heavy SDK; injected fetch for offline tests).
 *
 * Conventions:
 * - Virtual-hosted style: https://{bucket}.s3.{region}.amazonaws.com/{key}
 * - Payloads always carry a declared SHA-256 ( UNSIGNED is not used ).
 * - List uses list-type=2 and extracts <Key> from the XML with a minimal parser
 *   documented (S3 listings are flat and bounded).
 */
export class S3StorageProvider implements StorageProvider {
  private readonly baseUrl: URL;

  constructor(private readonly config: S3StorageProviderConfig) {
    if (!config.bucket || !config.region || !config.accessKeyId || !config.secretAccessKey) {
      throw new InfrastructureError(
        "S3 requiere bucket, region, accessKeyId y secretAccessKey",
        "S3_CONFIG_MISSING"
      );
    }

    const base = config.endpoint
      ? new URL(config.endpoint)
      : new URL(`https://${config.bucket}.s3.${config.region}.amazonaws.com/`);

    if (base.protocol !== "https:" && base.protocol !== "http:") {
      throw new InfrastructureError("Invalid S3 endpoint: protocol not allowed", "S3_CONFIG_INVALID_ENDPOINT");
    }

    this.baseUrl = base;
  }

  // ── SigV4 signature ────────────────────────────────────

  /**
   * Phase 19 §15/§23 — defense in depth: keys are built internally
   * with UUID ids, but if an external input ever reaches this point, path
   * traversal and prefix escape are blocked.
   */
  private sanitizeKey(key: string): string {
    if (
      !key ||
      key.startsWith("/") ||
      key.includes("\\") ||
      key.includes("//") ||
      key.includes("?") ||
      key.includes("#") ||
      key.includes("%") ||
      /[\u0000-\u001F\u007F]/.test(key)
    ) {
      throw new InfrastructureError(
        `Unsafe storage key: "${key}"`,
        "UNSAFE_STORAGE_KEY"
      );
    }

    const segments = key.split("/");
    if (segments.some((s) => s.length === 0 || s === "." || s === "..")) {
      throw new InfrastructureError(
        `Unsafe storage key: "${key}"`,
        "UNSAFE_STORAGE_KEY"
      );
    }

    return key;
  }

  private buildObjectUrl(key: string): URL {
    const sanitizedKey = this.sanitizeKey(key);
    const encodedKey = sanitizedKey
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/");

    const url = new URL(this.baseUrl.toString());
    const basePath = url.pathname.replace(/\/+$/, "");
    url.pathname = `${basePath}/${encodedKey}`;
    url.search = "";
    url.hash = "";
    return url;
  }

  private signRequest(method: "GET" | "PUT" | "DELETE", key: string, body?: Buffer): HeadersInit & Record<string, string> {
    const url = this.buildObjectUrl(key);
    const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
    const dateStamp = amzDate.slice(0, 8);
    const payloadHash = body ? sha256Hex(body) : EMPTY_SHA256;

    const host = url.host;
    const canonicalUri = url.pathname;

    const canonicalHeaders =
      `host:${host}\n` +
      `x-amz-content-sha256:${payloadHash}\n` +
      `x-amz-date:${amzDate}\n`;
    const signedHeaders = "host;x-amz-content-sha256;x-amz-date";

    const canonicalRequest = [
      method,
      canonicalUri,
      "", // empty query string for object ops
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join("\n");

    const scope = `${dateStamp}/${this.config.region}/s3/aws4_request`;
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      amzDate,
      scope,
      sha256Hex(canonicalRequest),
    ].join("\n");

    const signingKey = hmac(
      hmac(hmac(hmac(`AWS4${this.config.secretAccessKey}`, dateStamp), this.config.region), "s3"),
      "aws4_request"
    );
    const signature = createHmac("sha256", signingKey).update(stringToSign).digest("hex");

    return {
      host,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
      Authorization: `AWS4-HMAC-SHA256 Credential=${this.config.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    };
  }

  private async do(method: "GET" | "PUT" | "DELETE", key: string, body?: Buffer): Promise<Response> {
    const headers = this.signRequest(method, key, body);
    const url = this.buildObjectUrl(key);
    try {
      return await withProviderMetrics({ provider: "s3", operation: method }, async () => {
        return await (this.config.fetchImpl ?? fetch)(url.toString(), {
          method,
          headers,
          body: body ? new Uint8Array(body) : undefined,
        });
      });
    } catch (err) {
      throw new InfrastructureError(
        `S3 request failed (${method} ${key}): ${(err as Error).message}`,
        "STORAGE_REQUEST_FAILED"
      );
    }
  }

  // ── Port StorageProvider ────────────────────────────────

  async put(path: string, content: Buffer): Promise<void> {
    const key = this.sanitizeKey(path);
    const res = await this.do("PUT", key, content);
    if (!res.ok) {
      throw new InfrastructureError(
        `S3 PUT ${path} → ${res.status}`,
        "STORAGE_PUT_FAILED"
      );
    }
  }

  async get(path: string): Promise<Buffer> {
    const key = this.sanitizeKey(path);
    const res = await this.do("GET", key);
    if (!res.ok) {
      throw new InfrastructureError(
        `S3 GET ${path} → ${res.status}${res.status === 404 ? " (no existe)" : ""}`,
        res.status === 404 ? "STORAGE_FILE_NOT_FOUND" : "STORAGE_GET_FAILED"
      );
    }
    return Buffer.from(await res.arrayBuffer());
  }

  async delete(path: string): Promise<void> {
    const key = this.sanitizeKey(path);
    const res = await this.do("DELETE", key);
    // DELETE is idempotent in S3: 204 or 404 both count as success.
    if (!res.ok && res.status !== 404) {
      throw new InfrastructureError(`S3 DELETE ${path} → ${res.status}`, "STORAGE_DELETE_FAILED");
    }
  }

  async exists(path: string): Promise<boolean> {
    const key = this.sanitizeKey(path);
    const res = await this.do("HEAD" as "GET", key);
    return res.ok;
  }

  /** Minimal XML parser: extracts <Key>…</Key> from a paginated ListObjectsV2. */
  async list(prefix: string): Promise<string[]> {
    const queryUrl = new URL(
      `${this.config.endpoint ?? `https://${this.config.bucket}.s3.${this.config.region}.amazonaws.com`}`
    );
    void queryUrl;

    const keys: string[] = [];
    let token: string | undefined;

    do {
      const search = new URLSearchParams({
        "list-type": "2",
        prefix,
        ...(token ? { "continuation-token": token } : {}),
      });
      const url = `${this.config.endpoint ?? `https://${this.config.bucket}.s3.${this.config.region}.amazonaws.com`}/?${search}`;
      const headers = this.signListHeaders(search.toString());
      let res: Response;
      try {
        res = await (this.config.fetchImpl ?? fetch)(url, { method: "GET", headers });
      } catch (err) {
        throw new InfrastructureError(`S3 LIST failed: ${(err as Error).message}`, "STORAGE_LIST_FAILED");
      }
      if (!res.ok) {
        throw new InfrastructureError(`S3 LIST → ${res.status}`, "STORAGE_LIST_FAILED");
      }
      const xml = await res.text();
      for (const match of xml.matchAll(/<Key>([^<]+)<\/Key>/g)) keys.push(match[1]!);
      token = /<NextContinuationToken>([^<]+)<\/NextContinuationToken>/.exec(xml)?.[1];
    } while (token);

    return keys;
  }

  /** Signing variant for requests with a query string (sorted canonical query). */
  private signListHeaders(canonicalQuery: string): Record<string, string> {
    const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
    const dateStamp = amzDate.slice(0, 8);
    const host = `${this.config.bucket}.s3.${this.config.region}.amazonaws.com`;
    const payloadHash = EMPTY_SHA256;
    const signedHeaders = "host;x-amz-content-sha256;x-amz-date";

    const canonicalRequest = [
      "GET",
      "/",
      canonicalQuery,
      `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`,
      signedHeaders,
      payloadHash,
    ].join("\n");

    const scope = `${dateStamp}/${this.config.region}/s3/aws4_request`;
    const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonicalRequest)].join("\n");
    const signingKey = hmac(
      hmac(hmac(hmac(`AWS4${this.config.secretAccessKey}`, dateStamp), this.config.region), "s3"),
      "aws4_request"
    );
    const signature = createHmac("sha256", signingKey).update(stringToSign).digest("hex");

    return {
      host,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
      Authorization: `AWS4-HMAC-SHA256 Credential=${this.config.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    };
  }
}



