import { Router } from "express";
import { ApplicationError, NotFoundError, SecretCipher } from "@sitedock/shared";
import { PrismaClient } from "@prisma/client";
import {
  CreateServiceUseCase,
  EnqueueServiceDeploymentUseCase,
  GetServiceUseCase,
  ListServicesUseCase,
  RollbackServiceUseCase,
  ServiceEnvironmentUseCase,
  UpdateServiceUseCase,
  ContainerService,
  PrismaContainerInstanceRepository,
  PrismaServiceDeploymentLogRepository,
  PrismaServiceDeploymentRepository,
  PrismaServiceRepository,
} from "@sitedock/deployment";
import {
  AssertWorkspaceAccessUseCase,
  PrismaWorkspaceRepository,
} from "@sitedock/workspace";
import { PrismaProjectRepository } from "@sitedock/website";
import { requireSession } from "../middleware/require-session";

const prisma = new PrismaClient();

const serviceRepository = new PrismaServiceRepository();
const serviceDeploymentRepository = new PrismaServiceDeploymentRepository();
const containerInstanceRepository = new PrismaContainerInstanceRepository();
const deploymentLogRepository = new PrismaServiceDeploymentLogRepository();
const containerService = new ContainerService();
const workspaceRepository = new PrismaWorkspaceRepository();
const projectRepository = new PrismaProjectRepository();
const assertWorkspaceAccess = new AssertWorkspaceAccessUseCase(workspaceRepository);

const createService = new CreateServiceUseCase(serviceRepository);
const updateService = new UpdateServiceUseCase(serviceRepository);
const secretCipher = SecretCipher.fromEnv(process.env);
const serviceEnvironment = new ServiceEnvironmentUseCase(serviceRepository, secretCipher);
const getService = new GetServiceUseCase(serviceRepository);
const listServices = new ListServicesUseCase(serviceRepository);
const enqueueServiceDeployment = new EnqueueServiceDeploymentUseCase(serviceRepository, serviceDeploymentRepository);
const rollbackService = new RollbackServiceUseCase(
  serviceRepository,
  serviceDeploymentRepository,
  containerInstanceRepository,
  deploymentLogRepository,
  containerService,
  secretCipher
);

type WorkspaceParams = { workspaceId: string };
type ServiceParams = WorkspaceParams & { serviceId: string };

export const serviceRouter = Router({ mergeParams: true });

serviceRouter.use(requireSession);

/**
 * Tenant-scoped service lookup. A service id from another workspace is
 * indistinguishable from a nonexistent one (404), preventing cross-tenant
 * reads, deployments, logs and rollbacks.
 */
async function assertServiceAccess(workspaceId: string, serviceId: string) {
  const service = await serviceRepository.findByIdForWorkspace(serviceId, workspaceId);
  if (!service) throw new NotFoundError("Service", serviceId);
  return service;
}

serviceRouter.post<WorkspaceParams>("/", async (req, res, next) => {
  try {
    const userId = req.userId!;
    const { workspaceId } = req.params;
    await assertWorkspaceAccess.execute({
      workspaceId,
      userId,
      requiredRoles: ["OWNER", "ADMIN", "DEVELOPER"],
    });

    const body = req.body ?? {};
    if (!body.projectId || typeof body.projectId !== "string") {
      throw new ApplicationError("projectId is required", "MISSING_PROJECT_ID");
    }
    const project = await projectRepository.findByIdInWorkspace(body.projectId, workspaceId as never);
    if (!project) throw new NotFoundError("Project", body.projectId);
    
    const organizationId = (project as { organizationId?: string | null }).organizationId;
    if (organizationId) {
      const membership = await prisma.organizationMember.findFirst({
        where: { organizationId, userId },
      });
      const accountOrg = await prisma.accountOrganization.findFirst({
        where: { organizationId, accountId: userId },
      });
      if (!membership && !accountOrg) {
        throw new NotFoundError("Project", body.projectId);
      }
    }

    // Validate environment if provided
    if (body.environmentId) {
      const env = await prisma.environment.findFirst({
        where: { id: body.environmentId, projectId: project.id },
      });
      if (!env) throw new NotFoundError("Environment", body.environmentId);
    }

    if (body.secrets !== undefined) {
      throw new ApplicationError(
        "Use PUT /:serviceId/environment to set encrypted secrets after creating the service",
        "SECRETS_REQUIRE_ENVIRONMENT_ENDPOINT"
      );
    }

    const result = await createService.execute({
      projectId: project.id,
      environmentId: body.environmentId,
      name: body.name,
      type: body.type,
      hostname: body.hostname,
      sourceType: body.sourceType,
      sourceUrl: body.sourceUrl,
      sourceBranch: body.sourceBranch,
      sourcePath: body.sourcePath,
      dockerfile: body.dockerfile,
      contextFiles: body.contextFiles,
      buildCommand: body.buildCommand,
      startCommand: body.startCommand,
      port: body.port,
      env: body.env,
      cpuLimit: body.cpuLimit,
      memoryLimit: body.memoryLimit,
      pidsLimit: body.pidsLimit,
      readonlyRoot: body.readonlyRoot,
    });

    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

serviceRouter.get<WorkspaceParams>("/", async (req, res, next) => {
  try {
    const userId = req.userId!;
    const { workspaceId } = req.params;
    await assertWorkspaceAccess.execute({ workspaceId, userId });

    const { projectId } = req.query;
    if (!projectId || typeof projectId !== "string") {
      throw new ApplicationError("projectId query parameter is required", "MISSING_PROJECT_ID");
    }
    const project = await projectRepository.findByIdInWorkspace(projectId, workspaceId as never);
    if (!project) throw new NotFoundError("Project", projectId);

    const services = await listServices.execute(project.id);
    res.json(services);
  } catch (err) {
    next(err);
  }
});

serviceRouter.get<ServiceParams>("/:serviceId", async (req, res, next) => {
  try {
    const userId = req.userId!;
    await assertWorkspaceAccess.execute({ workspaceId: req.params.workspaceId, userId });
    // assertServiceAccess is workspace-scoped, so a cross-tenant id is a 404.
    await assertServiceAccess(req.params.workspaceId, req.params.serviceId);
    res.json(await getService.execute(req.params.serviceId));
  } catch (err) {
    next(err);
  }
});

serviceRouter.patch<ServiceParams>("/:serviceId", async (req, res, next) => {
  try {
    const userId = req.userId!;
    await assertWorkspaceAccess.execute({
      workspaceId: req.params.workspaceId,
      userId,
      requiredRoles: ["OWNER", "ADMIN", "DEVELOPER"],
    });
    await assertServiceAccess(req.params.workspaceId, req.params.serviceId);

    const body = req.body ?? {};
    res.json(
      await updateService.execute({
        serviceId: req.params.serviceId,
        dockerfile: body.dockerfile,
        contextFiles: body.contextFiles,
        sourceType: body.sourceType,
        sourceUrl: body.sourceUrl,
        sourceBranch: body.sourceBranch,
        sourcePath: body.sourcePath,
        buildCommand: body.buildCommand,
        startCommand: body.startCommand,
        port: body.port,
        env: body.env,
        cpuLimit: body.cpuLimit,
        memoryLimit: body.memoryLimit,
        pidsLimit: body.pidsLimit,
        readonlyRoot: body.readonlyRoot,
      })
    );
  } catch (err) {
    next(err);
  }
});

serviceRouter.get<ServiceParams>("/:serviceId/environment", async (req, res, next) => {
  try {
    const userId = req.userId!;
    await assertWorkspaceAccess.execute({
      workspaceId: req.params.workspaceId,
      userId,
      requiredRoles: ["OWNER", "ADMIN", "DEVELOPER"],
    });
    await assertServiceAccess(req.params.workspaceId, req.params.serviceId);
    res.json(await serviceEnvironment.get(req.params.serviceId));
  } catch (err) {
    next(err);
  }
});

serviceRouter.put<ServiceParams>("/:serviceId/environment", async (req, res, next) => {
  try {
    const userId = req.userId!;
    await assertWorkspaceAccess.execute({
      workspaceId: req.params.workspaceId,
      userId,
      requiredRoles: ["OWNER", "ADMIN", "DEVELOPER"],
    });
    await assertServiceAccess(req.params.workspaceId, req.params.serviceId);

    const body = req.body ?? {};
    res.json(
      await serviceEnvironment.update({
        serviceId: req.params.serviceId,
        variables: body.variables,
        secrets: body.secrets,
      })
    );
  } catch (err) {
    next(err);
  }
});

serviceRouter.post<ServiceParams>("/:serviceId/deploy", async (req, res, next) => {
  try {
    const userId = req.userId!;
    await assertWorkspaceAccess.execute({
      workspaceId: req.params.workspaceId,
      userId,
      requiredRoles: ["OWNER", "ADMIN", "DEVELOPER"],
    });
    const service = await assertServiceAccess(req.params.workspaceId, req.params.serviceId);

    const body = req.body ?? {};
    // Allow passing commit SHA for git deployments
    if (body.commitSha || body.sourceCommitSha) {
      (service as { sourceCommitSha?: string }).sourceCommitSha = body.commitSha || body.sourceCommitSha;
      try { await serviceRepository.save(service); } catch {}
    }
    const enqueued = await enqueueServiceDeployment.execute({
      serviceId: req.params.serviceId,
      idempotencyKey: body.idempotencyKey,
    });

    res.status(202).json({
      message: "Deployment queued",
      serviceId: req.params.serviceId,
      deploymentId: enqueued.deploymentId,
      version: enqueued.version,
      status: enqueued.status,
    });
  } catch (err) {
    next(err);
  }
});

serviceRouter.get<ServiceParams>("/:serviceId/deployments", async (req, res, next) => {
  try {
    const userId = req.userId!;
    await assertWorkspaceAccess.execute({ workspaceId: req.params.workspaceId, userId });
    await assertServiceAccess(req.params.workspaceId, req.params.serviceId);
    res.json(await serviceDeploymentRepository.listByService(req.params.serviceId));
  } catch (err) {
    next(err);
  }
});

serviceRouter.get<ServiceParams>("/:serviceId/logs", async (req, res, next) => {
  try {
    const userId = req.userId!;
    await assertWorkspaceAccess.execute({ workspaceId: req.params.workspaceId, userId });
    await assertServiceAccess(req.params.workspaceId, req.params.serviceId);
    const deploymentsList = await serviceDeploymentRepository.listByService(req.params.serviceId);
    const logs = await Promise.all(deploymentsList.map((d) => deploymentLogRepository.listByDeployment(d.id)));
    res.json(logs.flat());
  } catch (err) {
    next(err);
  }
});

serviceRouter.post<ServiceParams>("/:serviceId/rollback", async (req, res, next) => {
  try {
    const userId = req.userId!;
    const { workspaceId, serviceId } = req.params;
    await assertWorkspaceAccess.execute({
      workspaceId,
      userId,
      requiredRoles: ["OWNER", "ADMIN", "DEVELOPER"],
    });
    await assertServiceAccess(workspaceId, serviceId);

    const targetVersion = Number(req.body?.targetVersion);
    if (!targetVersion || Number.isNaN(targetVersion)) {
      throw new ApplicationError("targetVersion must be a valid number", "INVALID_TARGET_VERSION");
    }

    const result = await rollbackService.execute({
      serviceId,
      targetVersion,
    });

    res.status(200).json({
      message: `Rolled back to version ${targetVersion}`,
      serviceId,
      deploymentId: result.deploymentId,
      version: result.version,
      containerId: result.containerId,
      hostPort: result.hostPort,
    });
  } catch (err) {
    next(err);
  }
});

export default serviceRouter;
