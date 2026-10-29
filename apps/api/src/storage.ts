import { createStorageProviderFromEnv } from "@sitedock/deployment";

/**
 * Shared StorageProvider instance used by both deployment uploads and public
 * website serving. Using a single instance ensures that files uploaded via the
 * API are publicly retrievable through the /sites/:subdomain/ route.
 */
export const { storage } = createStorageProviderFromEnv();
