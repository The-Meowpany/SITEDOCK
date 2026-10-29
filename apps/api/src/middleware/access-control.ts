import { ForbiddenError, NotFoundError, UserId, WebsiteId, WorkspaceId } from "@sitedock/shared";
import { PrismaClientRepository } from "@sitedock/client";
import {
  AssertWorkspaceAccessUseCase,
  PrismaWorkspaceRepository,
} from "@sitedock/workspace";
import { PrismaWebsiteRepository } from "@sitedock/website";
import { PrismaClient } from "@prisma/client";

const assertWorkspaceAccess = new AssertWorkspaceAccessUseCase(new PrismaWorkspaceRepository());
const clients = new PrismaClientRepository();
const websites = new PrismaWebsiteRepository();
const prisma = new PrismaClient();

export interface AccessContext {
  role: "OWNER" | "ADMIN" | "DEVELOPER" | "CLIENT";
  /**
   * Set ONLY when the caller is a CLIENT-role member: every website-scoped
   * read/action must then be limited to this exact client's resources.
   * This is what closes the intra-tenant IDOR where one client could list,
   * read or approve another client's website — tenant isolation alone does
   * NOT imply client isolation.
   */
  clientIdScope: string | null;
  /**
   * Set when the caller has organization-scoped access. When present,
   * every resource access must verify the resource belongs to the caller's
   * organization, not just the workspace. Prevents cross-tenant IDOR.
   */
  organizationIdScope: string | null;
}

/**
 * Resolves the caller's standing in a workspace WITHOUT touching a specific
 * resource yet. Use for collection endpoints that must filter by client scope
 * (e.g. GET /websites). For single-resource endpoints prefer
 * assertWebsiteAccess, which additionally verifies the resource itself.
 */
export async function resolveWorkspaceAccess(params: {
  workspaceId: string;
  userId: string;
  organizationId?: string;
  requiredRoles?: Array<"OWNER" | "ADMIN" | "DEVELOPER">;
}): Promise<AccessContext> {
  const workspace = await assertWorkspaceAccess.execute({
    workspaceId: params.workspaceId,
    userId: params.userId,
    requiredRoles: params.requiredRoles as never,
  });

  const role = workspace.roleOf(UserId(params.userId))!;
  let clientIdScope: string | null = null;
  let organizationIdScope: string | null = null;

  if (role !== "CLIENT") {
    return { role, clientIdScope: null, organizationIdScope: null };
  }

  const client = await clients.findByUserIdInWorkspace(UserId(params.userId), WorkspaceId(params.workspaceId));
  if (!client) {
    // A CLIENT-role member with no linked client record sees nothing.
    throw new ForbiddenError("This account is not linked to a client of this workspace");
  }
  clientIdScope = client.id;

  // If organizationId is provided, verify the client belongs to that organization
  if (params.organizationId) {
    const member = await prisma.organizationMember.findFirst({
      where: { organizationId: params.organizationId, userId: params.userId },
    });
    const accountOrg = await prisma.accountOrganization.findFirst({
      where: { organizationId: params.organizationId, accountId: params.userId },
    });
    if (member || accountOrg) {
      organizationIdScope = params.organizationId;
    } else {
      organizationIdScope = null;
    }
  }

  return { role, clientIdScope, organizationIdScope };
}

/**
 * Full gate for a single website-scoped operation:
 *   membership → role policy → (CLIENT) ownership of THAT website.
 * Fails closed: any doubt is a 403/404, never a pass-through.
 */
export async function assertWebsiteAccess(params: {
  workspaceId: string;
  userId: string;
  websiteId: string;
  requiredRoles?: Array<"OWNER" | "ADMIN" | "DEVELOPER">;
}): Promise<AccessContext> {
  const context = await resolveWorkspaceAccess(params);

  if (context.clientIdScope) {
    const website = await websites.findByIdInWorkspace(
      WebsiteId(params.websiteId),
      WorkspaceId(params.workspaceId)
    );
    if (!website) throw new NotFoundError("Website", params.websiteId);
    if (website.clientId !== context.clientIdScope) {
      // 404 rather than 403: don't confirm the existence of other clients' sites.
      throw new NotFoundError("Website", params.websiteId);
    }
  }

  return context;
}
