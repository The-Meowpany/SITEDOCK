import { Router } from "express";
import { z } from "zod";
import { CreateClientUseCase, GetClientUseCase, ListClientsUseCase, PrismaClientRepository } from "@sitedock/client";
import { AssertWorkspaceAccessUseCase, PrismaWorkspaceRepository } from "@sitedock/workspace";
import { requireSession } from "../middleware/require-session";
import { auditBestEffort } from "../audit";

const clients = new PrismaClientRepository();
const workspaces = new PrismaWorkspaceRepository();
const assertWorkspaceAccess = new AssertWorkspaceAccessUseCase(workspaces);

const createClient = new CreateClientUseCase(clients);
const listClients = new ListClientsUseCase(clients);
const getClient = new GetClientUseCase(clients);

const createClientSchema = z.object({ fullName: z.string().min(2), email: z.string().email() });

type WorkspaceParams = { workspaceId: string };
type ClientParams = WorkspaceParams & { clientId: string };

// Mounted at /api/v1/workspaces/:workspaceId/clients — every route re-validates
// tenant membership before touching the ClientRepository (docs/ARCHITECTURE.md §19).
// Explicit <Params> generics below are required because Express's typings don't
// infer parent-router params even with { mergeParams: true } at runtime.
export const clientRouter = Router({ mergeParams: true });

clientRouter.use(requireSession);

clientRouter.post<WorkspaceParams>("/", async (req, res, next) => {
  try {
    await assertWorkspaceAccess.execute({ workspaceId: req.params.workspaceId, userId: req.userId!, requiredRoles: ["OWNER", "ADMIN", "DEVELOPER"] });
    const body = createClientSchema.parse(req.body);
    const result = await createClient.execute({ workspaceId: req.params.workspaceId, ...body });
    auditBestEffort({ workspaceId: req.params.workspaceId, actorId: req.userId!, action: "CLIENT_CREATED", resourceType: "Client", resourceId: result.clientId });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

clientRouter.get<WorkspaceParams>("/", async (req, res, next) => {
  try {
    await assertWorkspaceAccess.execute({ workspaceId: req.params.workspaceId, userId: req.userId! });
    res.json(await listClients.execute(req.params.workspaceId));
  } catch (err) {
    next(err);
  }
});

clientRouter.get<ClientParams>("/:clientId", async (req, res, next) => {
  try {
    await assertWorkspaceAccess.execute({ workspaceId: req.params.workspaceId, userId: req.userId! });
    res.json(await getClient.execute(req.params.clientId, req.params.workspaceId));
  } catch (err) {
    next(err);
  }
});
