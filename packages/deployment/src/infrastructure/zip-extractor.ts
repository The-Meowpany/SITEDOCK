import yauzl from "yauzl";
import { DomainError } from "@sitedock/shared";
import { DEFAULT_UPLOAD_VALIDATION_OPTIONS, UploadEntry, UploadValidationOptions, validateUploadEntries } from "../domain/upload-validation";
import { UploadedFile } from "../application/create-deployment.use-case";

const SYMLINK_MODE = 0xa000;

function isSymlinkEntry(externalFileAttributes: number): boolean {
  const unixMode = externalFileAttributes >>> 16;
  return (unixMode & 0xf000) === SYMLINK_MODE;
}

/**
 * Extracts a ZIP archive into an in-memory list of {path, content}, validating
 * every entry against validateUploadEntries() BEFORE decompressing its content.
 * This is the infrastructure counterpart of docs/ARCHITECTURE.md §28 — the
 * domain rule lives in upload-validation.ts, this module only adapts yauzl's
 * event API to it and never trusts the zip's declared sizes without checking.
 */
export function extractZipSafely(
  zipBuffer: Buffer,
  options: UploadValidationOptions = DEFAULT_UPLOAD_VALIDATION_OPTIONS
): Promise<UploadedFile[]> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(zipBuffer, { lazyEntries: true, validateEntrySizes: true }, (err, zipfile) => {
      if (err || !zipfile) {
        reject(new DomainError("Uploaded file is not a valid ZIP archive", "INVALID_ZIP"));
        return;
      }

      const entries: { entry: yauzl.Entry; isDirectory: boolean; isSymlink: boolean }[] = [];

      zipfile.readEntry();

      zipfile.on("entry", (entry: yauzl.Entry) => {
        const isDirectory = /\/$/.test(entry.fileName);
        const isSymlink = isSymlinkEntry(entry.externalFileAttributes);
        entries.push({ entry, isDirectory, isSymlink });
        zipfile.readEntry();
      });

      zipfile.on("error", (zipErr) => reject(zipErr));

      zipfile.on("end", async () => {
        try {
          const uploadEntries: UploadEntry[] = entries.map(({ entry, isDirectory, isSymlink }) => ({
            path: entry.fileName,
            sizeBytes: entry.uncompressedSize,
            isDirectory,
            isSymlink,
          }));

          // Validate metadata for every entry BEFORE reading a single byte of content.
          validateUploadEntries(uploadEntries, options);

          const files: UploadedFile[] = [];

          for (const { entry, isDirectory } of entries) {
            if (isDirectory) continue;
            const content = await readEntryContent(zipfile, entry);
            if (content.length !== entry.uncompressedSize) {
              // Declared size didn't match actual decompressed size — reject as a
              // possible zip-bomb / corrupted-archive attempt rather than trusting metadata.
              throw new DomainError(
                `Declared size for "${entry.fileName}" did not match actual decompressed size`,
                "SIZE_MISMATCH"
              );
            }
            files.push({ path: entry.fileName, content });
          }

          resolve(files);
        } catch (validationErr) {
          reject(validationErr);
        }
      });
    });
  });
}

function readEntryContent(zipfile: yauzl.ZipFile, entry: yauzl.Entry): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    zipfile.openReadStream(entry, (err, stream) => {
      if (err || !stream) {
        reject(err ?? new Error(`Failed to open stream for ${entry.fileName}`));
        return;
      }
      const chunks: Buffer[] = [];
      stream.on("data", (chunk) => chunks.push(chunk as Buffer));
      stream.on("end", () => resolve(Buffer.concat(chunks)));
      stream.on("error", reject);
    });
  });
}
