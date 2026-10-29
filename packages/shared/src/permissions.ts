export type Permission =
  | "organization.read"
  | "organization.update"
  | "organization.transfer"
  | "organization.delete"
  | "members.read"
  | "members.invite"
  | "members.change_role"
  | "members.remove"
  | "billing.read"
  | "billing.manage"
  | "project.create"
  | "project.read"
  | "project.update"
  | "project.delete"
  | "service.create"
  | "service.read"
  | "service.update"
  | "service.delete"
  | "deployment.create"
  | "deployment.read"
  | "deployment.promote"
  | "deployment.rollback"
  | "deployment.cancel"
  | "runtime.restart"
  | "runtime.inspect"
  | "logs.read"
  | "metrics.read"
  | "secrets.write"
  | "secrets.reference"
  | "secrets.reveal"
  | "domain.manage"
  | "git.connect"
  | "git.manage"
  | "integration.manage"
  | "database.provision"
  | "database.manage"
  | "storage.manage"
  | "environment.manage"
  | "production.deploy"
  | "production.rollback";

export type PermissionScope = "organization" | "project" | "environment";

export interface ScopedPermission {
  permission: Permission;
  scope?: PermissionScope;
}

export const ALL_PERMISSIONS: Permission[] = [
  "organization.read",
  "organization.update",
  "organization.transfer",
  "organization.delete",
  "members.read",
  "members.invite",
  "members.change_role",
  "members.remove",
  "billing.read",
  "billing.manage",
  "project.create",
  "project.read",
  "project.update",
  "project.delete",
  "service.create",
  "service.read",
  "service.update",
  "service.delete",
  "deployment.create",
  "deployment.read",
  "deployment.promote",
  "deployment.rollback",
  "deployment.cancel",
  "runtime.restart",
  "runtime.inspect",
  "logs.read",
  "metrics.read",
  "secrets.write",
  "secrets.reference",
  "secrets.reveal",
  "domain.manage",
  "git.connect",
  "git.manage",
  "integration.manage",
  "database.provision",
  "database.manage",
  "storage.manage",
  "environment.manage",
  "production.deploy",
  "production.rollback",
];

export type OrganizationRoleName =
  | "OWNER"
  | "ORGANIZATION_OWNER"
  | "ORGANIZATION_ADMINISTRATOR"
  | "ADMINISTRATOR"
  | "DEVELOPER"
  | "OPERATOR"
  | "ANALYST"
  | "VIEWER";

const OWNER_PERMISSIONS: Permission[] = [...ALL_PERMISSIONS];

const ORG_ADMIN_PERMISSIONS: Permission[] = [
  "organization.read",
  "organization.update",
  "members.read",
  "members.invite",
  "members.change_role",
  "members.remove",
  "billing.read",
  "project.create",
  "project.read",
  "project.update",
  "project.delete",
  "service.create",
  "service.read",
  "service.update",
  "service.delete",
  "deployment.create",
  "deployment.read",
  "deployment.promote",
  "deployment.rollback",
  "deployment.cancel",
  "runtime.restart",
  "runtime.inspect",
  "logs.read",
  "metrics.read",
  "secrets.write",
  "secrets.reference",
  "secrets.reveal",
  "domain.manage",
  "git.connect",
  "git.manage",
  "integration.manage",
  "database.provision",
  "database.manage",
  "storage.manage",
  "environment.manage",
  "production.deploy",
  "production.rollback",
];

const DEVELOPER_PERMISSIONS: Permission[] = [
  "organization.read",
  "project.read",
  "project.create",
  "project.update",
  "service.create",
  "service.read",
  "service.update",
  "service.delete",
  "deployment.create",
  "deployment.read",
  "deployment.rollback",
  "runtime.inspect",
  "logs.read",
  "secrets.write",
  "secrets.reference",
  "git.connect",
  "environment.manage",
];

const OPERATOR_PERMISSIONS: Permission[] = [
  "organization.read",
  "project.read",
  "service.read",
  "service.update",
  "deployment.read",
  "deployment.rollback",
  "deployment.cancel",
  "runtime.restart",
  "runtime.inspect",
  "logs.read",
  "metrics.read",
];

const ANALYST_PERMISSIONS: Permission[] = [
  "organization.read",
  "project.read",
  "service.read",
  "deployment.read",
  "logs.read",
  "metrics.read",
];

const VIEWER_PERMISSIONS: Permission[] = [
  "organization.read",
  "project.read",
  "service.read",
  "deployment.read",
];

export const ROLE_PERMISSIONS: Record<string, Permission[]> = {
  OWNER: OWNER_PERMISSIONS,
  ORGANIZATION_OWNER: OWNER_PERMISSIONS,
  ADMINISTRATOR: ORG_ADMIN_PERMISSIONS,
  ORGANIZATION_ADMINISTRATOR: ORG_ADMIN_PERMISSIONS,
  DEVELOPER: DEVELOPER_PERMISSIONS,
  OPERATOR: OPERATOR_PERMISSIONS,
  ANALYST: ANALYST_PERMISSIONS,
  VIEWER: VIEWER_PERMISSIONS,
};

export function hasPermission(role: string, permission: Permission): boolean {
  const perms = ROLE_PERMISSIONS[role];
  if (!perms) return false;
  return perms.includes(permission);
}

export function hasAnyPermission(role: string, permissions: Permission[]): boolean {
  return permissions.some((p) => hasPermission(role, p));
}

export function hasAllPermissions(role: string, permissions: Permission[]): boolean {
  return permissions.every((p) => hasPermission(role, p));
}
