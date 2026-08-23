import { Router } from "express";
import { z } from "zod";
import {
  ApproveWebsiteUseCase,
  CreateProjectUseCase,
  CreateWebsiteUseCase,
  GetWebsiteUseCase,
  ListProjectsUseCase,
  ListWebsitesUseCase,
  PrismaProjectRepository,
  PrismaWebsiteRepository,
  RejectWebsiteApprovalUseCase,
  RollbackWebsiteUseCase,
  SubmitWebsiteForApprovalUseCase,
} from "@sitedock/website";
import { AssertWorkspaceAccessUseCase, PrismaWorkspaceRepository } from "@sitedock/workspace";
import { assertWebsiteAccess, resolveWorkspaceAccess } from "../middleware/access-control";
import { requireSession } from "../middleware/require-session";
import { auditBestEffort } from "../audit";

const websites = new PrismaWebsiteRepository();
const projects = new PrismaProjectRepository();
const workspaces = new PrismaWorkspaceRepository();
const assertWorkspaceAccess = new AssertWorkspaceAccessUseCase(workspaces);

const createProject = new CreateProjectUseCase(projects);
const listProjects = new ListProjectsUseCase(projects);
const createWebsite = new CreateWebsiteUseCase(websites, projects);
const getWebsite = new GetWebsiteUseCase(websites);
const listWebsites = new ListWebsitesUseCase(websites);
const submitForApproval = new SubmitWebsiteForApprovalUseCase(websites);
const approveWebsite = new ApproveWebsiteUseCase(websites);
const rejectApproval = new RejectWebsiteApprovalUseCase(websites);
const rollbackWebsite = new RollbackWebsiteUseCase(websites);

const createProjectSchema = z.object({ name: z.string().min(2) });
const createWebsiteSchema = z.object({ projectId: z.string().uuid(), name: z.string().min(2) });

type WorkspaceParams = { workspaceId: string };
type WebsiteParams = WorkspaceParams & { websiteId: string };

// Mounted at /api/v1/workspaces/:workspaceId/projects and .../websites
export const projectRouter = Router({ mergeParams: true });
export const websiteRouter = Router({ mergeParams: true });

projectRouter.use(requireSession);
websiteRouter.use(requireSession);

projectRouter.get<WorkspaceParams>("/", async (req, res, next) => {
  try {
    await assertWorkspaceAccess.execute({ workspaceId: req.params.workspaceId, userId: req.userId! });
    res.json(await listProjects.execute(req.params.workspaceId));
  } catch (err) {
    next(err);
  }
});

projectRouter.post<WorkspaceParams>("/", async (req, res, next) => {
  try {
    await assertWorkspaceAccess.execute({ workspaceId: req.params.workspaceId, userId: req.userId!, requiredRoles: ["OWNER", "ADMIN", "DEVELOPER"] });
    const body = createProjectSchema.parse(req.body);
    res.status(201).json(await createProject.execute({ workspaceId: req.params.workspaceId, ...body }));
  } catch (err) {
    next(err);
  }
});

websiteRouter.post<WorkspaceParams>("/", async (req, res, next) => {
  try {
    await assertWorkspaceAccess.execute({ workspaceId: req.params.workspaceId, userId: req.userId!, requiredRoles: ["OWNER", "ADMIN", "DEVELOPER"] });
    const body = createWebsiteSchema.parse(req.body);
    const result = await createWebsite.execute({ workspaceId: req.params.workspaceId, ...body });
    auditBestEffort({ workspaceId: req.params.workspaceId, actorId: req.userId!, action: "WEBSITE_CREATED", resourceType: "Website", resourceId: result.websiteId });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

websiteRouter.get<WorkspaceParams>("/", async (req, res, next) => {
  try {
    const { clientIdScope } = await resolveWorkspaceAccess({
      workspaceId: req.params.workspaceId,
      userId: req.userId!,
    });
    const list = await listWebsites.execute(req.params.workspaceId);
    // CLIENT-role members only ever see their own website(s) — never another
    // client's, even inside the same workspace.
    res.json(clientIdScope ? list.filter((w) => w.clientId === clientIdScope) : list);
  } catch (err) {
    next(err);
  }
});

websiteRouter.get<WebsiteParams>("/:websiteId", async (req, res, next) => {
  try {
    await assertWebsiteAccess({
      workspaceId: req.params.workspaceId,
      userId: req.userId!,
      websiteId: req.params.websiteId,
    });
    res.json(await getWebsite.execute(req.params.websiteId, req.params.workspaceId));
  } catch (err) {
    next(err);
  }
});

websiteRouter.post<WebsiteParams>("/:websiteId/submit-for-approval", async (req, res, next) => {
  try {
    await assertWorkspaceAccess.execute({ workspaceId: req.params.workspaceId, userId: req.userId!, requiredRoles: ["OWNER", "ADMIN", "DEVELOPER"] });
    await submitForApproval.execute(req.params.websiteId, req.params.workspaceId);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// Client approval flow: any member may act, but CLIENT-role members ONLY on
// their own website (assertWebsiteAccess enforces ownership for them).
websiteRouter.post<WebsiteParams>("/:websiteId/approve", async (req, res, next) => {
  try {
    await assertWebsiteAccess({
      workspaceId: req.params.workspaceId,
      userId: req.userId!,
      websiteId: req.params.websiteId,
    });
    await approveWebsite.execute(req.params.websiteId, req.params.workspaceId);
    auditBestEffort({ workspaceId: req.params.workspaceId, actorId: req.userId!, action: "WEBSITE_APPROVED", resourceType: "Website", resourceId: req.params.websiteId });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

websiteRouter.post<WebsiteParams>("/:websiteId/reject-approval", async (req, res, next) => {
  try {
    await assertWebsiteAccess({
      workspaceId: req.params.workspaceId,
      userId: req.userId!,
      websiteId: req.params.websiteId,
    });
    await rejectApproval.execute(req.params.websiteId, req.params.workspaceId);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

websiteRouter.post<WebsiteParams>("/:websiteId/rollback", async (req, res, next) => {
  try {
    await assertWorkspaceAccess.execute({ workspaceId: req.params.workspaceId, userId: req.userId!, requiredRoles: ["OWNER", "ADMIN", "DEVELOPER"] });
    const { targetDeploymentId } = z.object({ targetDeploymentId: z.string().uuid() }).parse(req.body);
    await rollbackWebsite.execute({ websiteId: req.params.websiteId, workspaceId: req.params.workspaceId, targetDeploymentId });
    auditBestEffort({ workspaceId: req.params.workspaceId, actorId: req.userId!, action: "DEPLOYMENT_ROLLBACK", resourceType: "Website", resourceId: req.params.websiteId, metadata: { targetDeploymentId } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
