import { InfrastructureError } from "@sitedock/shared";
import { StorageProvider } from "../domain/ports";

/**
 * In-memory StorageProvider for demo/test mode (docs/ARCHITECTURE.md §45 "Demo Mode").
 * Swappable 1:1 with an S3StorageProvider without touching any use case, since both
 * implement the same StorageProvider port.
 */
export class MockStorageProvider implements StorageProvider {
  private files = new Map<string, Buffer>();

  async put(path: string, content: Buffer): Promise<void> {
    this.files.set(path, content);
  }

  async get(path: string): Promise<Buffer> {
    const content = this.files.get(path);
    if (!content) {
      throw new InfrastructureError(`File not found in storage: ${path}`, "STORAGE_FILE_NOT_FOUND");
    }
    return content;
  }

  async delete(path: string): Promise<void> {
    this.files.delete(path);
  }

  async list(prefix: string): Promise<string[]> {
    return [...this.files.keys()].filter((p) => p.startsWith(prefix));
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }
}
