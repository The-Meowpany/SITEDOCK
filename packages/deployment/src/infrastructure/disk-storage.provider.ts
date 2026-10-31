import { mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { InfrastructureError } from "@sitedock/shared";
import { StorageProvider } from "../domain/ports";

/**
 * DiskStorageProvider stores objects on the local filesystem.
 *
 * This is intended for local development and testing. Production should use
 * S3StorageProvider with a real S3-compatible bucket.
 *
 * All paths are rooted at a configurable base directory. Keys are stored as
 * files relative to that root, with parent directories created automatically.
 *
 * Persistence: objects survive API process restarts because they are written
 * to disk. This is suitable for local development verification but should not
 * be used in production without a real object storage service.
 */
export class DiskStorageProvider implements StorageProvider {
  private readonly root: string;

  constructor(rootDir: string) {
    this.root = resolve(rootDir);
  }

  private fullPath(key: string): string {
    // Prove the resolved path cannot escape `root`. A regex check on `..` is not
    // enough: `join`/`resolve` treat `..` segments after a drive letter or a
    // backslash differently on Windows (CWE-22). Resolve the candidate absolute
    // path first, then require it to still live under the root.
    if (
      !key ||
      key.includes("\0") ||
      key.includes("\\") ||
      key.startsWith("/") ||
      key.includes("//")
    ) {
      throw new InfrastructureError(`Unsafe storage key: "${key}"`, "UNSAFE_STORAGE_KEY");
    }
    const full = resolve(this.root, key);
    if (full === this.root) return this.root;
    if (!full.startsWith(this.root + sep)) {
      throw new InfrastructureError(`Unsafe storage key: "${key}"`, "UNSAFE_STORAGE_KEY");
    }
    return full;
  }

  async put(key: string, content: Buffer): Promise<void> {
    const path = this.fullPath(key);
    const dir = resolve(path, "..");
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(path, content);
  }

  async get(key: string): Promise<Buffer> {
    const path = this.fullPath(key);
    if (!existsSync(path)) {
      throw new InfrastructureError(`File not found in storage: ${key}`, "STORAGE_FILE_NOT_FOUND");
    }
    return readFileSync(path);
  }

  async delete(key: string): Promise<void> {
    const path = this.fullPath(key);
    if (existsSync(path)) {
      unlinkSync(path);
    }
  }

  async list(prefix: string): Promise<string[]> {
    const cleanPrefix = prefix.replace(/\/$/, "");
    const dirPath = this.fullPath(cleanPrefix);
    if (!existsSync(dirPath)) {
      return [];
    }
    const stat = statSync(dirPath);
    if (stat.isFile()) {
      return [cleanPrefix];
    }
    const results: string[] = [];
    const walk = (dir: string, basePrefix: string) => {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        const relativeKey = basePrefix ? `${basePrefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          walk(fullPath, relativeKey);
        } else {
          results.push(relativeKey);
        }
      }
    };
    walk(dirPath, cleanPrefix);
    return results;
  }

  async exists(key: string): Promise<boolean> {
    try {
      return existsSync(this.fullPath(key));
    } catch {
      return false;
    }
  }
}
