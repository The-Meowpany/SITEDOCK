import { DomainError } from "@sitedock/shared";
import posixPath from "node:path/posix";

export interface UploadEntry {
  /** Path as declared inside the uploaded archive, e.g. "assets/logo.png". */
  path: string;
  /** Uncompressed size in bytes, as reported by the archive's central directory. */
  sizeBytes: number;
  /** True for directory entries (paths ending in "/"). */
  isDirectory?: boolean;
  /** True if the archive entry declares itself as a symlink — must always be rejected. */
  isSymlink?: boolean;
}

export interface UploadValidationOptions {
  maxFileSizeBytes: number;
  maxTotalSizeBytes: number;
  maxFileCount: number;
  allowedExtensions: readonly string[];
}

export const DEFAULT_UPLOAD_VALIDATION_OPTIONS: UploadValidationOptions = {
  maxFileSizeBytes: 25 * 1024 * 1024, // 25 MB per file
  maxTotalSizeBytes: 250 * 1024 * 1024, // 250 MB per deployment
  maxFileCount: 5000,
  allowedExtensions: [
    ".html", ".htm", ".css", ".js", ".mjs", ".json", ".svg", ".png", ".jpg", ".jpeg",
    ".gif", ".webp", ".ico", ".woff", ".woff2", ".ttf", ".otf", ".eot", ".txt", ".xml",
    ".webmanifest", ".map",
  ],
};

/** Extensions that are always rejected regardless of `allowedExtensions` — defense in depth. */
const DANGEROUS_EXTENSIONS = new Set([
  ".exe", ".sh", ".bash", ".php", ".php3", ".php4", ".php5", ".phtml", ".py", ".rb",
  ".jsp", ".jspx", ".asp", ".aspx", ".cgi", ".pl", ".dll", ".so", ".bat", ".cmd",
  ".com", ".msi", ".ps1", ".vbs", ".jar", ".war", ".dmg", ".app", ".htaccess",
]);

function hasPathTraversal(entryPath: string): boolean {
  if (entryPath.includes("\0")) return true; // null byte injection
  if (posixPath.isAbsolute(entryPath)) return true; // absolute paths escape the deployment root
  const normalized = posixPath.normalize(entryPath);
  if (normalized.startsWith("..") || normalized.includes("/../") || normalized === "..") return true;
  return false;
}

function extensionOf(entryPath: string): string {
  return posixPath.extname(entryPath).toLowerCase();
}

/**
 * Validates a list of archive entries BEFORE anything is written to storage.
 * This is the single choke point protecting against path traversal, zip bombs,
 * dangerous executables, and oversized uploads (docs/ARCHITECTURE.md §28
 * "Static Content Security"). Throws DomainError with a specific code on the
 * first violation found.
 */
export function validateUploadEntries(entries: UploadEntry[], options: UploadValidationOptions = DEFAULT_UPLOAD_VALIDATION_OPTIONS): void {
  const fileEntries = entries.filter((e) => !e.isDirectory);

  if (fileEntries.length === 0) {
    throw new DomainError("Upload must contain at least one file", "EMPTY_UPLOAD");
  }

  if (fileEntries.length > options.maxFileCount) {
    throw new DomainError(
      `Upload contains ${fileEntries.length} files, exceeding the limit of ${options.maxFileCount}`,
      "TOO_MANY_FILES"
    );
  }

  let totalSize = 0;

  for (const entry of entries) {
    if (entry.isSymlink) {
      throw new DomainError(`Symlinks are not allowed: "${entry.path}"`, "SYMLINK_NOT_ALLOWED");
    }

    if (hasPathTraversal(entry.path)) {
      throw new DomainError(`Invalid or unsafe path in upload: "${entry.path}"`, "PATH_TRAVERSAL_DETECTED");
    }

    if (entry.isDirectory) continue;

    const ext = extensionOf(entry.path);

    if (DANGEROUS_EXTENSIONS.has(ext)) {
      throw new DomainError(`File type not allowed: "${entry.path}"`, "DANGEROUS_FILE_TYPE");
    }

    if (!options.allowedExtensions.includes(ext)) {
      throw new DomainError(`File extension "${ext}" is not permitted: "${entry.path}"`, "DISALLOWED_EXTENSION");
    }

    if (entry.sizeBytes < 0) {
      throw new DomainError(`Invalid file size for "${entry.path}"`, "INVALID_FILE_SIZE");
    }

    if (entry.sizeBytes > options.maxFileSizeBytes) {
      throw new DomainError(
        `File "${entry.path}" (${entry.sizeBytes} bytes) exceeds the per-file limit of ${options.maxFileSizeBytes} bytes`,
        "FILE_TOO_LARGE"
      );
    }

    totalSize += entry.sizeBytes;

    // Zip-bomb guard: bail out as soon as the running total exceeds the limit,
    // rather than waiting to sum every entry first.
    if (totalSize > options.maxTotalSizeBytes) {
      throw new DomainError(
        `Upload total size exceeds the limit of ${options.maxTotalSizeBytes} bytes (possible zip bomb)`,
        "UPLOAD_TOO_LARGE"
      );
    }
  }

  const hasIndex = fileEntries.some((e) => posixPath.normalize(e.path).replace(/^\.\//, "") === "index.html");
  if (!hasIndex) {
    throw new DomainError('Upload must contain a root "index.html"', "MISSING_INDEX_HTML");
  }
}

export function computeTotalSize(entries: UploadEntry[]): number {
  return entries.filter((e) => !e.isDirectory).reduce((sum, e) => sum + e.sizeBytes, 0);
}
