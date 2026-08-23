import { randomUUID } from "node:crypto";
import { ApplicationError, WebsiteId } from "@sitedock/shared";
import { Deployment } from "../domain/deployment.entity";
import { DeploymentRepository, StorageProvider } from "../domain/ports";
import {
  DEFAULT_UPLOAD_VALIDATION_OPTIONS,
  UploadEntry,
  UploadValidationOptions,
  computeTotalSize,
  validateUploadEntries,
} from "../domain/upload-validation";

export interface UploadedFile {
  path: string;
  content: Buffer;
  contentType?: string;
}

export interface CreateDeploymentCommand {
  websiteId: string;
  uploadedById: string;
  files: UploadedFile[];
}

function contentTypeFor(path: string): string {
  const ext = path.slice(path.lastIndexOf(".")).toLowerCase();
  const map: Record<string, string> = {
    ".html": "text/html", ".htm": "text/html", ".css": "text/css", ".js": "application/javascript",
    ".mjs": "application/javascript", ".json": "application/json", ".svg": "image/svg+xml",
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
    ".webp": "image/webp", ".ico": "image/x-icon", ".woff": "font/woff", ".woff2": "font/woff2",
    ".ttf": "font/ttf", ".otf": "font/otf", ".txt": "text/plain", ".xml": "application/xml",
  };
  return map[ext] ?? "application/octet-stream";
}

/**
 * Pipeline: UPLOAD → VALIDATE → STORE → CREATE DEPLOYMENT → READY.
 * For static-site MVP there is no real "build" step, so BUILDING is transient.
 * Every uploaded file goes through validateUploadEntries() before a single byte
 * is written to storage (docs/ARCHITECTURE.md §12 "Deployment System").
 */
export class CreateDeploymentUseCase {
  constructor(
    private readonly deployments: DeploymentRepository,
    private readonly storage: StorageProvider,
    private readonly uploadOptions: UploadValidationOptions = DEFAULT_UPLOAD_VALIDATION_OPTIONS
  ) {}

  async execute(command: CreateDeploymentCommand): Promise<{ deploymentId: string; version: number; previewPath: string }> {
    const websiteId = WebsiteId(command.websiteId);

    const entries: UploadEntry[] = command.files.map((f) => ({ path: f.path, sizeBytes: f.content.length }));

    try {
      validateUploadEntries(entries, this.uploadOptions);
    } catch (err) {
      // Domain validation errors are surfaced as-is (400-level); nothing gets stored.
      throw err;
    }

    const version = await this.deployments.getNextVersion(websiteId);
    const deploymentId = randomUUID();
    const storagePath = `websites/${websiteId}/deployments/${deploymentId}`;

    const deployment = Deployment.create({
      id: deploymentId,
      websiteId,
      version,
      storagePath,
      uploadedById: command.uploadedById,
    });

    deployment.startBuilding();

    try {
      for (const file of command.files) {
        await this.storage.put(`${storagePath}/${file.path}`, file.content, file.contentType ?? contentTypeFor(file.path));
      }
    } catch (err) {
      deployment.markFailed(err instanceof Error ? err.message : "Unknown storage error while writing deployment files");
      await this.deployments.save(deployment);
      throw new ApplicationError("Failed to store deployment files", "DEPLOYMENT_STORAGE_FAILED");
    }

    deployment.markReady({ fileCount: command.files.length, sizeBytes: computeTotalSize(entries) });
    await this.deployments.save(deployment);

    return { deploymentId: deployment.id, version: deployment.version, previewPath: storagePath };
  }
}
