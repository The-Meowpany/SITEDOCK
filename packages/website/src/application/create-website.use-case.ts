import { randomUUID } from "node:crypto";
import { ConflictError, WebsiteId, WorkspaceId } from "@sitedock/shared";
import { Project } from "../domain/project.entity";
import { Website } from "../domain/website.entity";
import { ProjectRepository, WebsiteRepository } from "../domain/ports";

export class CreateProjectUseCase {
  constructor(private readonly projects: ProjectRepository) {}

  async execute(command: { workspaceId: string; name: string }): Promise<{ projectId: string }> {
    const project = Project.create({ id: randomUUID(), workspaceId: WorkspaceId(command.workspaceId), name: command.name });
    await this.projects.save(project);
    return { projectId: project.id };
  }
}

export interface CreateWebsiteCommand {
  workspaceId: string;
  projectId: string;
  name: string;
}

/**
 * Creates a Website in DRAFT status. Retries subdomain generation on collision
 * (extremely unlikely given the id suffix, but never silently overwrite another
 * tenant's subdomain).
 */
export class CreateWebsiteUseCase {
  constructor(
    private readonly websites: WebsiteRepository,
    private readonly projects: ProjectRepository
  ) {}

  async execute(command: CreateWebsiteCommand): Promise<{ websiteId: string; subdomain: string }> {
    const workspaceId = WorkspaceId(command.workspaceId);

    const project = await this.projects.findByIdInWorkspace(command.projectId, workspaceId);
    if (!project) {
      throw new ConflictError("Project does not exist in this workspace");
    }

    const website = Website.create({
      id: WebsiteId(randomUUID()),
      workspaceId,
      projectId: command.projectId,
      name: command.name,
    });

    const collision = await this.websites.findBySubdomain(website.subdomain);
    if (collision) {
      throw new ConflictError("Generated subdomain is already taken — please retry");
    }

    await this.websites.save(website);
    return { websiteId: website.id, subdomain: website.subdomain };
  }
}
