import { Router } from "express";
import { NotFoundError } from "@sitedock/shared";
import { PrismaClient } from "@prisma/client";
import { AssertWorkspaceAccessUseCase, PrismaWorkspaceRepository } from "@sitedock/workspace";
import { requireSession } from "../middleware/require-session";

const prisma = new PrismaClient();
const workspaceRepository = new PrismaWorkspaceRepository();
const assertWorkspaceAccess = new AssertWorkspaceAccessUseCase(workspaceRepository);

type ProjectParams = { workspaceId: string; projectId: string };
type EnvParams = ProjectParams & { environmentId: string };

export const environmentRouter = Router({ mergeParams: true });

environmentRouter.use(requireSession);

environmentRouter.post<ProjectParams>("/", async (req, res, next) => {
  try {
    const userId = req.userId!;
    await assertWorkspaceAccess.execute({
      workspaceId: req.params.workspaceId,
      userId,
      requiredRoles: ["OWNER", "ADMIN", "DEVELOPER"],
    });

    const project = await prisma.project.findFirst({
      where: { id: req.params.projectId, workspaceId: req.params.workspaceId },
    });
    if (!project) throw new NotFoundError("Project", req.params.projectId);
    
    // Enforce organization ownership if project belongs to an organization
    if (project.organizationId) {
      const membership = await prisma.organizationMember.findFirst({
        where: { organizationId: project.organizationId, userId },
      });
      const accountOrg = await prisma.accountOrganization.findFirst({
        where: { organizationId: project.organizationId, accountId: userId },
      });
      if (!membership && !accountOrg) {
        throw new NotFoundError("Project", req.params.projectId);
      }
    }

    const body = req.body ?? {};
    const env = await prisma.environment.create({
      data: {
        projectId: project.id,
        name: body.name || "Development",
        slug: body.slug || "development",
        type: body.type || "DEVELOPMENT",
        status: body.status || "ACTIVE",
        isDefault: body.isDefault || false,
        branch: body.branch || null,
        pullRequest: body.pullRequest || null,
        env: body.env || null,
        secrets: body.secrets || null,
      },
    });
    res.status(201).json(env);
  } catch (err) {
    next(err);
  }
});

environmentRouter.get<ProjectParams>("/", async (req, res, next) => {
  try {
    const userId = req.userId!;
    await assertWorkspaceAccess.execute({ workspaceId: req.params.workspaceId, userId });
    const project = await prisma.project.findFirst({
      where: { id: req.params.projectId, workspaceId: req.params.workspaceId },
    });
    if (!project) throw new NotFoundError("Project", req.params.projectId);
    if (project.organizationId) {
      const membership = await prisma.organizationMember.findFirst({
        where: { organizationId: project.organizationId, userId },
      });
      const accountOrg = await prisma.accountOrganization.findFirst({
        where: { organizationId: project.organizationId, accountId: userId },
      });
      if (!membership && !accountOrg) throw new NotFoundError("Project", req.params.projectId);
    }
    const environments = await prisma.environment.findMany({
      where: { projectId: project.id },
      orderBy: { createdAt: "asc" },
    });
    res.json(environments);
  } catch (err) {
    next(err);
  }
});

environmentRouter.get<EnvParams>("/:environmentId", async (req, res, next) => {
  try {
    const userId = req.userId!;
    await assertWorkspaceAccess.execute({ workspaceId: req.params.workspaceId, userId });
    const project = await prisma.project.findFirst({
      where: { id: req.params.projectId, workspaceId: req.params.workspaceId },
    });
    if (!project) throw new NotFoundError("Project", req.params.projectId);
    if (project.organizationId) {
      const membership = await prisma.organizationMember.findFirst({
        where: { organizationId: project.organizationId, userId },
      });
      const accountOrg = await prisma.accountOrganization.findFirst({
        where: { organizationId: project.organizationId, accountId: userId },
      });
      if (!membership && !accountOrg) throw new NotFoundError("Environment", req.params.environmentId);
    }
    const env = await prisma.environment.findFirst({
      where: { id: req.params.environmentId, projectId: project.id },
    });
    if (!env) throw new NotFoundError("Environment", req.params.environmentId);
    res.json(env);
  } catch (err) {
    next(err);
  }
});

environmentRouter.patch<EnvParams>("/:environmentId", async (req, res, next) => {
  try {
    const userId = req.userId!;
    await assertWorkspaceAccess.execute({
      workspaceId: req.params.workspaceId,
      userId,
      requiredRoles: ["OWNER", "ADMIN", "DEVELOPER"],
    });
    const project = await prisma.project.findFirst({
      where: { id: req.params.projectId, workspaceId: req.params.workspaceId },
    });
    if (!project) throw new NotFoundError("Project", req.params.projectId);
    if (project.organizationId) {
      const membership = await prisma.organizationMember.findFirst({
        where: { organizationId: project.organizationId, userId },
      });
      const accountOrg = await prisma.accountOrganization.findFirst({
        where: { organizationId: project.organizationId, accountId: userId },
      });
      if (!membership && !accountOrg) throw new NotFoundError("Environment", req.params.environmentId);
    }
    const body = req.body ?? {};
    const env = await prisma.environment.update({
      where: { id: req.params.environmentId },
      data: {
        name: body.name,
        slug: body.slug,
        type: body.type,
        status: body.status,
        isDefault: body.isDefault,
        branch: body.branch,
        pullRequest: body.pullRequest,
        env: body.env,
        secrets: body.secrets,
      },
    });
    res.json(env);
  } catch (err) {
    next(err);
  }
});

environmentRouter.delete<EnvParams>("/:environmentId", async (req, res, next) => {
  try {
    const userId = req.userId!;
    await assertWorkspaceAccess.execute({
      workspaceId: req.params.workspaceId,
      userId,
      requiredRoles: ["OWNER", "ADMIN"],
    });
    const project = await prisma.project.findFirst({
      where: { id: req.params.projectId, workspaceId: req.params.workspaceId },
    });
    if (!project) throw new NotFoundError("Project", req.params.projectId);
    if (project.organizationId) {
      const membership = await prisma.organizationMember.findFirst({
        where: { organizationId: project.organizationId, userId },
      });
      const accountOrg = await prisma.accountOrganization.findFirst({
        where: { organizationId: project.organizationId, accountId: userId },
      });
      if (!membership && !accountOrg) throw new NotFoundError("Environment", req.params.environmentId);
    }
    await prisma.environment.delete({ where: { id: req.params.environmentId } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export default environmentRouter;
