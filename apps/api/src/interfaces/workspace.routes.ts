import { Router } from "express";
import { z } from "zod";
import {
  AcceptWorkspaceInvitationUseCase,
  AddWorkspaceMemberUseCase,
  AssertWorkspaceAccessUseCase,
  ChangeMemberRoleUseCase,
  CreateWorkspaceInvitationUseCase,
  CreateWorkspaceUseCase,
  DeleteWorkspaceUseCase,
  ListMyWorkspacesUseCase,
  PrismaWorkspaceInvitationRepository,
  PrismaWorkspaceRepository,
  RemoveWorkspaceMemberUseCase,
  RenameWorkspaceUseCase,
  TransferWorkspaceOwnershipUseCase,
  UpdateWorkspaceBrandingUseCase,
} from "@sitedock/workspace";
import { EmailAddress, ConflictError, ForbiddenError, UserId, WorkspaceId } from "@sitedock/shared";
import { EnsureClientForUserUseCase, PrismaClientRepository } from "@sitedock/client";
import { Argon2PasswordHasher, PrismaUserRepository } from "@sitedock/auth";
import { authRateLimiter } from "../middleware/rate-limit";
import { requireSession } from "../middleware/require-session";
import { config } from "../config";
import { auditBestEffort } from "../audit";
import { notifyBestEffort } from "../notifications";

const workspaces = new PrismaWorkspaceRepository();
const invitations = new PrismaWorkspaceInvitationRepository();
const clients = new PrismaClientRepository();
const users = new PrismaUserRepository();
const createWorkspace = new CreateWorkspaceUseCase(workspaces);
const listMyWorkspaces = new ListMyWorkspacesUseCase(workspaces);
const assertWorkspaceAccess = new AssertWorkspaceAccessUseCase(workspaces);
const addWorkspaceMember = new AddWorkspaceMemberUseCase(workspaces);
const createWorkspaceInvitation = new CreateWorkspaceInvitationUseCase(invitations);
const acceptWorkspaceInvitation = new AcceptWorkspaceInvitationUseCase(invitations, workspaces);
const ensureClientForUser = new EnsureClientForUserUseCase(clients);
const passwordHasher = new Argon2PasswordHasher();
const renameWorkspace = new RenameWorkspaceUseCase(workspaces);
const changeMemberRole = new ChangeMemberRoleUseCase(workspaces);
const removeWorkspaceMember = new RemoveWorkspaceMemberUseCase(workspaces, workspaces);
const transferOwnership = new TransferWorkspaceOwnershipUseCase(workspaces);
const deleteWorkspace = new DeleteWorkspaceUseCase(workspaces, workspaces);

const createWorkspaceSchema = z.object({ name: z.string().min(2) });
const inviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(["ADMIN", "DEVELOPER", "CLIENT"]),
});

export const workspaceRouter = Router();

workspaceRouter.use(requireSession);

workspaceRouter.post("/", async (req, res, next) => {
  try {
    const { name } = createWorkspaceSchema.parse(req.body);
    const result = await createWorkspace.execute({ name, ownerId: req.userId! });
    auditBestEffort({ workspaceId: result.workspaceId, actorId: req.userId!, action: "WORKSPACE_CREATED", resourceType: "Workspace", resourceId: result.workspaceId });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

workspaceRouter.get("/", async (req, res, next) => {
  try {
    const result = await listMyWorkspaces.execute(req.userId!);
    res.json(req.apiToken ? result.filter((workspace) => workspace.id === req.apiToken!.workspaceId) : result);
  } catch (err) {
    next(err);
  }
});

// Every workspace-scoped sub-resource route (websites, clients, plans, ...) added in
// later phases must call assertWorkspaceAccess before touching any repository —
// this is the tenant-isolation gate referenced throughout docs/ARCHITECTURE.md.
workspaceRouter.get("/:workspaceId", async (req, res, next) => {
  try {
    const workspace = await assertWorkspaceAccess.execute({
      workspaceId: req.params.workspaceId,
      userId: req.userId!,
    });
    res.json({ id: workspace.id, name: workspace.name, slug: workspace.slug, branding: workspace.branding, members: workspace.members });
  } catch (err) {
    next(err);
  }
});

// ── Workspace management: rename, members, ownership, deletion ─────────────

/** These change who controls a tenant: API tokens (CI/scripts) must never perform them. */
function rejectApiToken(req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) {
  if (req.apiToken) {
    res.status(403).json({ code: "FORBIDDEN", message: "API tokens cannot manage workspace settings or members" });
    return;
  }
  next();
}

const uuidParam = z.string().uuid();
const renameSchema = z.object({ name: z.string().min(2).max(120) });
const memberRoleSchema = z.object({ role: z.enum(["ADMIN", "DEVELOPER", "CLIENT"]) });
const transferSchema = z.object({ newOwnerUserId: z.string().uuid(), currentPassword: z.string().min(1) });
const deleteWorkspaceSchema = z.object({ confirmName: z.string().min(1), currentPassword: z.string().min(1) });

async function requirePassword(userId: string, password: string): Promise<void> {
  const user = await users.findById(UserId(userId));
  if (!user || !(await passwordHasher.verify(password, user.passwordHash))) {
    throw new ForbiddenError("Current password is incorrect");
  }
}

workspaceRouter.patch("/:workspaceId", rejectApiToken, async (req, res, next) => {
  try {
    const { name } = renameSchema.parse(req.body);
    const result = await renameWorkspace.execute({ workspaceId: uuidParam.parse(req.params.workspaceId), actorId: req.userId!, name });
    auditBestEffort({ workspaceId: req.params.workspaceId, actorId: req.userId!, action: "WORKSPACE_RENAMED", resourceType: "Workspace", resourceId: req.params.workspaceId });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

workspaceRouter.get("/:workspaceId/members", rejectApiToken, async (req, res, next) => {
  try {
    const workspace = await assertWorkspaceAccess.execute({
      workspaceId: uuidParam.parse(req.params.workspaceId),
      userId: req.userId!,
      requiredRoles: ["OWNER", "ADMIN", "DEVELOPER"],
    });
    const members = await Promise.all(
      workspace.members.map(async (m) => {
        const user = await users.findById(m.userId);
        return { userId: m.userId, fullName: user?.fullName ?? null, email: user?.email.value ?? null, role: m.role, joinedAt: m.joinedAt };
      })
    );
    res.json(members);
  } catch (err) {
    next(err);
  }
});

workspaceRouter.patch("/:workspaceId/members/:userId", rejectApiToken, async (req, res, next) => {
  try {
    const { role } = memberRoleSchema.parse(req.body);
    const workspaceId = uuidParam.parse(req.params.workspaceId);
    const targetUserId = uuidParam.parse(req.params.userId);
    await changeMemberRole.execute({ workspaceId, actorId: req.userId!, targetUserId, role });
    auditBestEffort({ workspaceId, actorId: req.userId!, action: "MEMBER_ROLE_CHANGED", resourceType: "WorkspaceMember", resourceId: targetUserId, metadata: { role } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

workspaceRouter.delete("/:workspaceId/members/:userId", rejectApiToken, async (req, res, next) => {
  try {
    const workspaceId = uuidParam.parse(req.params.workspaceId);
    const targetUserId = uuidParam.parse(req.params.userId);
    await removeWorkspaceMember.execute({ workspaceId, actorId: req.userId!, targetUserId });
    auditBestEffort({ workspaceId, actorId: req.userId!, action: "MEMBER_REMOVED", resourceType: "WorkspaceMember", resourceId: targetUserId, metadata: { self: targetUserId === req.userId } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

workspaceRouter.post("/:workspaceId/transfer-ownership", authRateLimiter, rejectApiToken, async (req, res, next) => {
  try {
    const { newOwnerUserId, currentPassword } = transferSchema.parse(req.body);
    const workspaceId = uuidParam.parse(req.params.workspaceId);
    await requirePassword(req.userId!, currentPassword);
    await transferOwnership.execute({ workspaceId, actorId: req.userId!, newOwnerUserId });
    auditBestEffort({ workspaceId, actorId: req.userId!, action: "OWNERSHIP_TRANSFERRED", resourceType: "Workspace", resourceId: workspaceId, metadata: { newOwnerUserId } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

workspaceRouter.delete("/:workspaceId", authRateLimiter, rejectApiToken, async (req, res, next) => {
  try {
    const { confirmName, currentPassword } = deleteWorkspaceSchema.parse(req.body);
    const workspaceId = uuidParam.parse(req.params.workspaceId);
    await requirePassword(req.userId!, currentPassword);
    await deleteWorkspace.execute({ workspaceId, actorId: req.userId!, confirmName });
    // workspaceId is deliberately null: the workspace row (and its FK target) no longer exists.
    auditBestEffort({ workspaceId: null, actorId: req.userId!, action: "WORKSPACE_DELETED", resourceType: "Workspace", resourceId: workspaceId });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// ── White-label branding (Phase 20) ──────────────────────

const brandingSchema = z.object({
  branding: z.record(
    z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/, "Key must be alphanumeric/underscore")
      .refine((k) => !["__proto__", "constructor", "prototype"].includes(k), "Forbidden key"),
    z.union([z.string().max(500), z.number(), z.boolean()])
  ).nullable()
});

workspaceRouter.patch("/:workspaceId/branding", async (req: import("express").Request<{ workspaceId: string }>, res, next) => {
  try {
    await assertWorkspaceAccess.execute({
      workspaceId: req.params.workspaceId,
      userId: req.userId!,
      requiredRoles: ["OWNER", "ADMIN"],
    });
    const body = brandingSchema.parse(req.body);
    const useCase = new UpdateWorkspaceBrandingUseCase(new PrismaWorkspaceRepository());
    const result = await useCase.execute({
      workspaceId: req.params.workspaceId,
      branding: body.branding,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * Direct-add shortcut: adds an EXISTING platform user (by email) to the
 * workspace immediately, no acceptance step. Useful for adding a teammate who
 * already has an account. For inviting someone who may NOT have an account
 * yet (the common "invite client" case), use POST /:workspaceId/invitations
 * instead — that one works either way and requires the person to accept.
 */
workspaceRouter.post("/:workspaceId/members", async (req, res, next) => {
  try {
    const workspace = await assertWorkspaceAccess.execute({
      workspaceId: req.params.workspaceId,
      userId: req.userId!,
      requiredRoles: ["OWNER", "ADMIN"],
    });

    const { email, role } = inviteSchema.parse(req.body);
    const targetUser = await users.findByEmail(EmailAddress.create(email));
    if (!targetUser) {
      throw new ConflictError(`No SiteDock account exists yet for ${email} — invite them instead via POST /invitations, or ask them to register first`);
    }

    await addWorkspaceMember.execute({ workspaceId: req.params.workspaceId, targetUserId: targetUser.id, role });

    auditBestEffort({
      workspaceId: req.params.workspaceId,
      actorId: req.userId!,
      action: "CLIENT_INVITED",
      resourceType: "WorkspaceMember",
      resourceId: targetUser.id,
      metadata: { email, role, method: "direct" },
    });

    notifyBestEffort({
      type: "client_invited",
      recipientEmail: email,
      clientName: targetUser.fullName,
      workspaceName: workspace.name,
      inviteUrl: `/portal/${workspace.id}`,
    });

    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

/**
 * "Invite client" (docs/ARCHITECTURE.md onboarding step 6 / §32 MVP checklist).
 * Creates a pending WorkspaceInvitation regardless of whether the invitee has
 * a SiteDock account — they accept it later via POST /invitations/:token/accept,
 * at which point they must be logged in with the exact email the invitation
 * was sent to (enforced by the WorkspaceInvitation aggregate itself, not just
 * here). The raw token is only ever handed to the NotificationService, never
 * returned in this response.
 */
workspaceRouter.post("/:workspaceId/invitations", async (req, res, next) => {
  try {
    const workspace = await assertWorkspaceAccess.execute({
      workspaceId: req.params.workspaceId,
      userId: req.userId!,
      requiredRoles: ["OWNER", "ADMIN"],
    });

    const { email, role } = inviteSchema.parse(req.body);
    const { invitationId, rawToken } = await createWorkspaceInvitation.execute({
      workspaceId: req.params.workspaceId,
      email,
      role,
      invitedById: req.userId!,
    });

    auditBestEffort({
      workspaceId: req.params.workspaceId,
      actorId: req.userId!,
      action: "CLIENT_INVITED",
      resourceType: "WorkspaceInvitation",
      resourceId: invitationId,
      metadata: { email, role, method: "token" },
    });

    notifyBestEffort({
      type: "client_invited",
      recipientEmail: email,
      clientName: email,
      workspaceName: workspace.name,
      inviteUrl: `/invite/${rawToken}`,
    });

    // Demo mode: there is no real email delivery, so the developer needs the link
// in the response to hand it to their client. Production returns only the id �
// the link travels by email.
    res.status(201).json(
      config.allowDemoEndpoints ? { invitationId, inviteUrl: `/invite/${rawToken}` } : { invitationId }
    );
  } catch (err) {
    next(err);
  }
});

/**
 * Accepting an invitation is deliberately NOT workspace-scoped through
 * assertWorkspaceAccess — the whole point is that the accepting user isn't a
 * member yet. Authorization instead comes from possessing the raw token AND
 * being logged in as the exact email it was addressed to (both checked inside
 * AcceptWorkspaceInvitationUseCase / WorkspaceInvitation.accept()).
 */
export const invitationRouter = Router();
invitationRouter.use(requireSession);

invitationRouter.post("/:token/accept", async (req, res, next) => {
  try {
    const me = await users.findById(UserId(req.userId!));
    if (!me) {
      res.status(401).json({ code: "UNAUTHORIZED", message: "Session user no longer exists" });
      return;
    }

    const result = await acceptWorkspaceInvitation.execute({
      rawToken: req.params.token,
      acceptingUserId: req.userId!,
      acceptingUserEmail: me.email.value,
    });

    const workspace = await workspaces.findById(WorkspaceId(result.workspaceId));
    if (workspace?.roleOf(UserId(req.userId!)) === "CLIENT") {
      const { clientId, created } = await ensureClientForUser.execute({
        workspaceId: result.workspaceId,
        userId: req.userId!,
        fullName: me.fullName,
        email: me.email.value,
      });

      auditBestEffort({
        workspaceId: result.workspaceId,
        actorId: req.userId!,
        action: created ? "CLIENT_CREATED" : "CLIENT_LINKED",
        resourceType: "Client",
        resourceId: clientId,
        metadata: { source: "invitation", invitationToken: req.params.token.slice(0, 8) },
      });
    }

    auditBestEffort({
      workspaceId: result.workspaceId,
      actorId: req.userId!,
      action: "INVITATION_ACCEPTED",
      resourceType: "WorkspaceInvitation",
      resourceId: req.params.token.slice(0, 8),
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});





