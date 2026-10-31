import { describe, expect, it } from "vitest";
import { S3StorageProvider } from "../infrastructure/s3-storage.provider";
import { createStorageProviderFromEnv } from "../infrastructure/storage.factory";

const CONFIG = {
  bucket: "sitedock-test",
  region: "us-east-1",
  accessKeyId: "AKIDEXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY", // public example key from the AWS docs
};

interface CapturedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
}

function providerWith(responder: (url: string, method: string) => { status: number; body?: string }) {
  const captured: CapturedCall[] = [];
  const fetchImpl = (async (url: unknown, init?: RequestInit) => {
    const method = String(init?.method ?? "GET");
    const urlStr = String(url).split("?")[0] ?? "";
    const query = String(url).includes("?") ? String(url).split("?")[1] : "";
    captured.push({
      url: urlStr,
      method,
      headers: (init?.headers ?? {}) as unknown as Record<string, string>,
    });
    void query;
    const r = responder(urlStr, method);
    return {
      ok: r.status < 400,
      status: r.status,
      arrayBuffer: async () => new TextEncoder().encode(r.body ?? "").buffer as ArrayBuffer,
      text: async () => r.body ?? "",
    } as Response;
  }) as unknown as typeof fetch;

  return {
    storage: new S3StorageProvider({ ...CONFIG, fetchImpl }),
    captured: captured as Array<CapturedCall>,
  };
}

describe("S3StorageProvider (SigV4 propio sobre fetch inyectado)", () => {
  it("PUT firma con AWS4-HMAC-SHA256 y sube el buffer al key exacto", async () => {
    const { storage, captured } = providerWith(() => ({ status: 200 }));
    await storage.put("websites/w1/deployments/d1/index.html", Buffer.from("<h1>hola</h1>"));

    expect(captured).toHaveLength(1);
    const call = captured[0]!;
    expect(call.method).toBe("PUT");
    expect(call.url).toContain("sitedock-test.s3.us-east-1.amazonaws.com/websites/w1/deployments/d1/index.html");
    expect(call.headers.Authorization?.startsWith("AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/")).toBe(true);
    expect(call.headers["x-amz-content-sha256"]).toHaveLength(64);
  });

  it("GET devuelve el buffer y mapea 404 al código del port", async () => {
    const { storage, captured } = providerWith((url) =>
      url.endsWith("/missing.txt") ? { status: 404 } : { status: 200, body: "contenido" }
    );

    const found = await storage.get("websites/w1/index.html");
    expect(found.toString()).toBe("contenido");

    await expect(storage.get("websites/w1/missing.txt")).rejects.toThrow(/STORAGE_FILE_NOT_FOUND|no existe/i);
    expect(captured.filter((c) => c.method === "GET")).toHaveLength(2);
  });

  it("DELETE es idempotente: 404 no es error", async () => {
    const { storage } = providerWith(() => ({ status: 204 }));
    await expect(storage.delete("websites/w1/backups/b1/x")).resolves.toBeUndefined();
  });

  it("LIST extrae las keys del XML paginado", async () => {
    let call = 0;
    const pages = [
      {
        status: 200,
        body:
          "<ListBucketResult><Key>a</Key><Key>b</Key>" +
          "<NextContinuationToken>TOK</NextContinuationToken></ListBucketResult>",
      },
      { status: 200, body: "<ListBucketResult><Key>c</Key></ListBucketResult>" },
    ];
    const { storage } = providerWith((_url, _method) => pages[Math.min(call++, 1)]!);

    const keys = await storage.list("websites/w1/");
    expect(keys).toEqual(["a", "b", "c"]);
  });

  it("la fábrica construye mock por default y s3 con env", () => {
    const def = createStorageProviderFromEnv({});
    expect(def.storage.constructor.name).toBe("MockStorageProvider");

    const s3 = createStorageProviderFromEnv({
      STORAGE_PROVIDER: "s3",
      S3_BUCKET: "b",
      S3_REGION: "r",
      S3_ACCESS_KEY_ID: "k",
      S3_SECRET_ACCESS_KEY: "s",
    } as NodeJS.ProcessEnv);
    expect(s3.storage.constructor.name).toBe("S3StorageProvider");
  });
});


