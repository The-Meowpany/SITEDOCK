import { WebsiteId, WorkspaceId } from "@sitedock/shared";
import { Website } from "./website.entity";
import { Project } from "./project.entity";

export interface ProjectRepository {
  findByIdInWorkspace(id: string, workspaceId: WorkspaceId): Promise<Project | null>;
  listByWorkspace(workspaceId: WorkspaceId): Promise<Project[]>;
  save(project: Project): Promise<void>;
}

export interface WebsiteRepository {
  findById(id: WebsiteId): Promise<Website | null>;
  /** Tenant-scoped lookup — the only safe way to fetch a website by id. */
  findByIdInWorkspace(id: WebsiteId, workspaceId: WorkspaceId): Promise<Website | null>;
  findBySubdomain(subdomain: string): Promise<Website | null>;
  listByWorkspace(workspaceId: WorkspaceId): Promise<Website[]>;
  /**
   * System-level scheduled-job query (docs/ARCHITECTURE.md §31) — same
   * contract as Subscription's listByStatus: legitimate ONLY from jobs,
   * never from a user-facing request.
   */
  listByStatus(status: Website["status"]): Promise<Website[]>;
  save(website: Website): Promise<void>;
}
