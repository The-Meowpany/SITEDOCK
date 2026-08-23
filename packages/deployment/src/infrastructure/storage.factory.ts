import { MockStorageProvider } from "./mock-storage.provider";
import { S3StorageProvider } from "./s3-storage.provider";
import type { StorageProvider } from "../domain/ports";

/**
 * Fábrica del StorageProvider según entorno (ADR-003/006).
 *   STORAGE_PROVIDER=mock (default) → MockStorageProvider
 *   STORAGE_PROVIDER=s3             → S3StorageProvider (S3_BUCKET/S3_REGION/S3_*)
 */
export function createStorageProviderFromEnv(env: NodeJS.ProcessEnv = process.env): { storage: StorageProvider } {
  const kind = env.STORAGE_PROVIDER ?? "mock";

  if (kind === "s3") {
    return {
      storage: new S3StorageProvider({
        bucket: env.S3_BUCKET ?? "",
        region: env.S3_REGION ?? "",
        accessKeyId: env.S3_ACCESS_KEY_ID ?? "",
        secretAccessKey: env.S3_SECRET_ACCESS_KEY ?? "",
        endpoint: env.S3_ENDPOINT,
      }),
    };
  }

  return { storage: new MockStorageProvider() };
}