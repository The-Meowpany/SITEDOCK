import { AuditAction } from "./audit-action";

export interface AuditEntryProps {
  id: string;
  workspaceId: string | null;
  actorId: string | null;
  action: AuditAction;
  resourceType: string;
  resourceId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}

/**
 * AuditEntry — append-only by design (docs/ARCHITECTURE.md §33: "Los audit
 * logs no deben modificarse arbitrariamente"). Unlike every other aggregate in
 * this codebase, AuditEntry has NO behavior methods and NO setters at all —
 * once created, it cannot be mutated, only read. There is deliberately no
 * `update()` or `delete()` anywhere in this bounded context.
 */
export class AuditEntry {
  private constructor(private readonly props: AuditEntryProps) {}

  static create(params: {
    id: string;
    workspaceId: string | null;
    actorId: string | null;
    action: AuditAction;
    resourceType: string;
    resourceId?: string | null;
    metadata?: Record<string, unknown> | null;
  }): AuditEntry {
    return new AuditEntry({
      id: params.id,
      workspaceId: params.workspaceId,
      actorId: params.actorId,
      action: params.action,
      resourceType: params.resourceType,
      resourceId: params.resourceId ?? null,
      metadata: params.metadata ?? null,
      createdAt: new Date(),
    });
  }

  static hydrate(props: AuditEntryProps): AuditEntry {
    return new AuditEntry(props);
  }

  get id() { return this.props.id; }
  get workspaceId() { return this.props.workspaceId; }
  get actorId() { return this.props.actorId; }
  get action() { return this.props.action; }
  get resourceType() { return this.props.resourceType; }
  get resourceId() { return this.props.resourceId; }
  get metadata() { return this.props.metadata; }
  get createdAt() { return this.props.createdAt; }
}
