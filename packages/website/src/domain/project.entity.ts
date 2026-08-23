import { DomainError, WorkspaceId } from "@sitedock/shared";

export interface ProjectProps {
  id: string;
  workspaceId: WorkspaceId;
  name: string;
  createdAt: Date;
}

/** Project is a lightweight grouping entity — a freelancer's engagement with a
 * given customer/brief, under which one or more Websites can be created. */
export class Project {
  private constructor(private props: ProjectProps) {}

  static create(params: { id: string; workspaceId: WorkspaceId; name: string }): Project {
    if (params.name.trim().length < 2) {
      throw new DomainError("Project name must have at least 2 characters", "INVALID_PROJECT_NAME");
    }
    return new Project({ id: params.id, workspaceId: params.workspaceId, name: params.name.trim(), createdAt: new Date() });
  }

  static hydrate(props: ProjectProps): Project {
    return new Project(props);
  }

  get id() { return this.props.id; }
  get workspaceId() { return this.props.workspaceId; }
  get name() { return this.props.name; }
  get createdAt() { return this.props.createdAt; }
}
