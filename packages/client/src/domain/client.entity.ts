import { ClientId, DomainError, EmailAddress, WorkspaceId } from "@sitedock/shared";

export interface ClientProps {
  id: ClientId;
  workspaceId: WorkspaceId;
  fullName: string;
  email: EmailAddress;
  userId: string | null; // linked once the client accepts an invitation and creates an account
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Client aggregate. Represents the freelancer's customer — the person who will
 * eventually pay a Subscription for a Website. Distinct from the platform User
 * (a Client only gets a User account once they accept an invitation).
 */
export class Client {
  private constructor(private props: ClientProps) {}

  static create(params: { id: ClientId; workspaceId: WorkspaceId; fullName: string; email: string }): Client {
    if (params.fullName.trim().length < 2) {
      throw new DomainError("Client full name must have at least 2 characters", "INVALID_CLIENT_NAME");
    }
    const now = new Date();
    return new Client({
      id: params.id,
      workspaceId: params.workspaceId,
      fullName: params.fullName.trim(),
      email: EmailAddress.create(params.email),
      userId: null,
      createdAt: now,
      updatedAt: now,
    });
  }

  static hydrate(props: ClientProps): Client {
    return new Client(props);
  }

  linkToUserAccount(userId: string): void {
    this.props.userId = userId;
    this.props.updatedAt = new Date();
  }

  get id() { return this.props.id; }
  get workspaceId() { return this.props.workspaceId; }
  get fullName() { return this.props.fullName; }
  get email() { return this.props.email; }
  get userId() { return this.props.userId; }
  get createdAt() { return this.props.createdAt; }
}
