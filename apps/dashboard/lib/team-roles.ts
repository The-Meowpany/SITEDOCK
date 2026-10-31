import type { MemberRole, MemberSummary } from "./api-client";

type Role = MemberSummary["role"];

/**
 * UI convenience only (hides controls the server would reject). The API enforces the
 * same matrix: OWNER manages everyone below OWNER, ADMIN only DEVELOPER/CLIENT.
 */
export function canManage(actor: Role | null, target: Role): boolean {
  if (actor === "OWNER") return target !== "OWNER";
  if (actor === "ADMIN") return target === "DEVELOPER" || target === "CLIENT";
  return false;
}

export function assignableRoles(actor: Role | null): MemberRole[] {
  if (actor === "OWNER") return ["ADMIN", "DEVELOPER", "CLIENT"];
  if (actor === "ADMIN") return ["DEVELOPER", "CLIENT"];
  return [];
}
