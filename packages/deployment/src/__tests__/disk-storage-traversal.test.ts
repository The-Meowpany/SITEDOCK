import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DiskStorageProvider } from "../infrastructure/disk-storage.provider";

describe("DiskStorageProvider path traversal", () => {
  const root = mkdtempSync(join(tmpdir(), "sitedock-disk-"));
  const storage = new DiskStorageProvider(root);

  it("stores and reads keys inside the root", async () => {
    await storage.put("a/b.txt", Buffer.from("ok"));
    expect((await storage.get("a/b.txt")).toString()).toBe("ok");
  });

  it.each(["../escape.txt", "a/../../escape.txt", "/etc/passwd", "a\\..\\x", "a//b", "a\0b"])(
    "rejects unsafe key %j",
    async (key) => {
      await expect(storage.put(key, Buffer.from("x"))).rejects.toMatchObject({ code: "UNSAFE_STORAGE_KEY" });
      await expect(storage.get(key)).rejects.toMatchObject({ code: "UNSAFE_STORAGE_KEY" });
      await expect(storage.delete(key)).rejects.toMatchObject({ code: "UNSAFE_STORAGE_KEY" });
    }
  );

  it("cleans up", () => rmSync(root, { recursive: true, force: true }));
});
