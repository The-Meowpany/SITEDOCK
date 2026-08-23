import { describe, expect, it } from "vitest";
import { DomainError, InvalidStateTransitionError, WebsiteId } from "@sitedock/shared";
import { Deployment } from "../domain/deployment.entity";
import { UploadEntry, UploadValidationOptions, validateUploadEntries } from "../domain/upload-validation";

const WEBSITE = WebsiteId("11111111-1111-1111-1111-111111111111");

const baseOptions: UploadValidationOptions = {
  maxFileSizeBytes: 1024 * 1024,
  maxTotalSizeBytes: 5 * 1024 * 1024,
  maxFileCount: 100,
  allowedExtensions: [".html", ".css", ".js", ".png"],
};

function entries(paths: Array<[string, number]>): UploadEntry[] {
  return paths.map(([path, sizeBytes]) => ({ path, sizeBytes }));
}

describe("validateUploadEntries — security", () => {
  it("accepts a normal static site upload with index.html", () => {
    const files = entries([
      ["index.html", 500],
      ["styles.css", 200],
      ["assets/logo.png", 1000],
    ]);
    expect(() => validateUploadEntries(files, baseOptions)).not.toThrow();
  });

  it("rejects when there is no root index.html", () => {
    const files = entries([["about.html", 500]]);
    expect(() => validateUploadEntries(files, baseOptions)).toThrow(/index\.html/);
  });

  it("rejects path traversal via ../", () => {
    const files = entries([["index.html", 100], ["../../etc/passwd", 100]]);
    expect(() => validateUploadEntries(files, baseOptions)).toThrow(DomainError);
    try {
      validateUploadEntries(files, baseOptions);
    } catch (err) {
      expect((err as DomainError).code).toBe("PATH_TRAVERSAL_DETECTED");
    }
  });

  it("rejects absolute paths", () => {
    const files = entries([["index.html", 100], ["/etc/passwd", 100]]);
    expect(() => validateUploadEntries(files, baseOptions)).toThrow(DomainError);
  });

  it("rejects null-byte injection in paths", () => {
    const files = entries([["index.html", 100], ["evil.html\0.png", 100]]);
    expect(() => validateUploadEntries(files, baseOptions)).toThrow(DomainError);
  });

  it("rejects symlink entries outright", () => {
    const files: UploadEntry[] = [
      { path: "index.html", sizeBytes: 100 },
      { path: "link", sizeBytes: 0, isSymlink: true },
    ];
    expect(() => validateUploadEntries(files, baseOptions)).toThrow(/Symlink/);
  });

  it("rejects dangerous extensions even if not explicitly excluded from allowedExtensions", () => {
    const files = entries([["index.html", 100], ["shell.php", 100]]);
    expect(() => validateUploadEntries(files, baseOptions)).toThrow(/not allowed/);
  });

  it("rejects extensions outside the allowlist", () => {
    const files = entries([["index.html", 100], ["document.pdf", 100]]);
    expect(() => validateUploadEntries(files, baseOptions)).toThrow(/not permitted/);
  });

  it("rejects a single file above the per-file size limit", () => {
    const files = entries([["index.html", 100], ["huge.png", 2 * 1024 * 1024]]);
    expect(() => validateUploadEntries(files, baseOptions)).toThrow(/exceeds the per-file limit/);
  });

  it("rejects an upload whose cumulative size exceeds the total limit (zip-bomb guard)", () => {
    const files = entries([
      ["index.html", 100],
      ["a.png", 900 * 1024],
      ["b.png", 900 * 1024],
      ["c.png", 900 * 1024],
      ["d.png", 900 * 1024],
      ["e.png", 900 * 1024],
      ["f.png", 900 * 1024],
    ]);
    expect(() => validateUploadEntries(files, baseOptions)).toThrow(/possible zip bomb/);
  });

  it("rejects when the file count exceeds the limit", () => {
    const many = Array.from({ length: 5 }, (_, i) => [`file${i}.html`, 10] as [string, number]);
    const options = { ...baseOptions, maxFileCount: 3 };
    expect(() => validateUploadEntries(entries([["index.html", 10], ...many]), options)).toThrow(/exceeding the limit of 3/);
  });

  it("allows directory entries without treating them as files", () => {
    const files: UploadEntry[] = [
      { path: "index.html", sizeBytes: 100 },
      { path: "assets/", sizeBytes: 0, isDirectory: true },
    ];
    expect(() => validateUploadEntries(files, baseOptions)).not.toThrow();
  });
});

describe("Deployment aggregate", () => {
  function newDeployment() {
    return Deployment.create({ id: "dep-1", websiteId: WEBSITE, version: 1, storagePath: "websites/x/deployments/dep-1", uploadedById: "user-1" });
  }

  it("starts QUEUED", () => {
    expect(newDeployment().status).toBe("QUEUED");
  });

  it("walks QUEUED → BUILDING → READY → PUBLISHED", () => {
    const d = newDeployment();
    d.startBuilding();
    expect(d.status).toBe("BUILDING");
    d.markReady({ fileCount: 3, sizeBytes: 1200 });
    expect(d.status).toBe("READY");
    expect(d.fileCount).toBe(3);
    d.publish();
    expect(d.status).toBe("PUBLISHED");
    expect(d.publishedAt).not.toBeNull();
  });

  it("cannot publish before READY", () => {
    const d = newDeployment();
    expect(() => d.publish()).toThrow(DomainError);
    d.startBuilding();
    expect(() => d.publish()).toThrow(DomainError);
  });

  it("moves to FAILED from BUILDING with an error message", () => {
    const d = newDeployment();
    d.startBuilding();
    d.markFailed("Storage write failed");
    expect(d.status).toBe("FAILED");
    expect(d.errorMessage).toBe("Storage write failed");
  });

  it("cannot transition out of a terminal PUBLISHED state", () => {
    const d = newDeployment();
    d.startBuilding();
    d.markReady({ fileCount: 1, sizeBytes: 10 });
    d.publish();
    expect(() => d.startBuilding()).toThrow(InvalidStateTransitionError);
  });
});
