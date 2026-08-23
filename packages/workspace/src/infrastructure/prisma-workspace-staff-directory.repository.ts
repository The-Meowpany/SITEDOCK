import { prisma } from "@sitedock/database";
import { WorkspaceId } from "@sitedock/shared";
import { WorkspaceStaffDirectory } from "../domain/ports";

/**
 * Joins workspace members (staff roles only, already joined) with their user
 * accounts to produce the notification list for operational alerts.
 */
export class PrismaWorkspaceStaffDirectory implements WorkspaceStaffDirectory {
  async listStaffEmails(workspaceId: WorkspaceId): Promise<string[]> {
    const members = await prisma.workspaceMember.findMany({
      where: { workspaceId, role: { in: ["OWNER", "ADMIN", "DEVELOPER"] }, joinedAt: { not: null } },
      select: { user: { select: { email: true } } },
    });
    return [...new Set(members.map((m) => m.user.email))];
  }
}
