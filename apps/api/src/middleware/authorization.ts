import { ForbiddenError, NotFoundError } from "@sitedock/shared";
import { hasPermission, ROLE_PERMISSIONS, type Permission } from "@sitedock/shared";
import { prisma } from "@sitedock/database";


export interface AuthorizationContext {
  userId: string;
  organizationId: string | null;
  workspaceId: string;
  role: string;
  permissions: Permission[];
}

export async function getUserOrganizationMembership(userId: string, organizationId: string) {
  const membership = await prisma.organizationMember.findFirst({
    where: {
      userId,
      organizationId,
    },
  });
  if (membership) {
    return membership;
  }
  const accountOrg = await prisma.accountOrganization.findFirst({
    where: {
      accountId: userId,
      organizationId,
    },
  });
  return accountOrg;
}

export async function assertOrganizationAccess(params: {
  userId: string;
  organizationId: string;
  requiredPermissions?: Permission[];
}): Promise<AuthorizationContext> {
  const membership = await getUserOrganizationMembership(params.userId, params.organizationId);
  if (!membership) {
    throw new ForbiddenError("Not a member of this organization");
  }

  const role = membership.role as string;
  const permissions = ROLE_PERMISSIONS[role] || [];

  if (params.requiredPermissions) {
    for (const perm of params.requiredPermissions) {
      if (!hasPermission(role, perm)) {
        throw new ForbiddenError(`Missing required permission: ${perm}`);
      }
    }
  }

  return {
    userId: params.userId,
    organizationId: params.organizationId,
    workspaceId: "", // filled by caller if needed
    role,
    permissions,
  };
}

export async function assertResourceOrganizationOwnership(params: {
  userId: string;
  resourceType: "project" | "service" | "deployment" | "website" | "environment";
  resourceId: string;
  organizationId?: string;
}): Promise<string | null> {
  // Resolve ownership from authoritative DB relationships
  if (params.resourceType === "project") {
    const project = await prisma.project.findUnique({
      where: { id: params.resourceId },
      include: { organization: true },
    });
    if (!project) throw new NotFoundError("Project", params.resourceId);
    if (params.organizationId && project.organizationId !== params.organizationId) {
      throw new NotFoundError("Project", params.resourceId); // enumeration resistance
    }
    return project.organizationId;
  } else if (params.resourceType === "service") {
    const service = await prisma.service.findUnique({
      where: { id: params.resourceId },
      include: { project: { include: { organization: true } } },
    });
    if (!service) throw new NotFoundError("Service", params.resourceId);
    if (params.organizationId && service.project.organizationId !== params.organizationId) {
      throw new NotFoundError("Service", params.resourceId);
    }
    return service.project.organizationId;
  } else if (params.resourceType === "website") {
    const website = await prisma.website.findUnique({
      where: { id: params.resourceId },
      include: { workspace: true },
    });
    if (!website) throw new NotFoundError("Website", params.resourceId);
    // Website might be linked to organization via workspace or directly
    const project = await prisma.project.findFirst({
      where: { websites: { some: { id: params.resourceId } } },
    });
    if (project) {
      if (params.organizationId && project.organizationId !== params.organizationId) {
        throw new NotFoundError("Website", params.resourceId);
      }
      return project.organizationId;
    }
    // Fallback: if we can't determine org, be strict
    if (params.organizationId) {
      throw new NotFoundError("Website", params.resourceId);
    }
    return null;
  } else if (params.resourceType === "environment") {
    const env = await prisma.environment.findUnique({
      where: { id: params.resourceId },
      include: { project: { include: { organization: true } } },
    });
    if (!env) throw new NotFoundError("Environment", params.resourceId);
    if (params.organizationId && env.project.organizationId !== params.organizationId) {
      throw new NotFoundError("Environment", params.resourceId);
    }
    return env.project.organizationId;
  }
  throw new NotFoundError(params.resourceType, params.resourceId);
}
