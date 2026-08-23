import { Router } from "express";
import { z } from "zod";
import {
  ListDomainsUseCase,
  MockDomainProvider,
  PrismaCustomDomainRepository,
  RegisterCustomDomainUseCase,
  VerifyCustomDomainUseCase,
} from "@sitedock/domains";
import { requireSession } from "../middleware/require-session";
import { assertWebsiteAccess } from "../middleware/access-control";
import { auditBestEffort } from "../audit";

// Singleton per process — same rationale as MockPaymentProvider (docs/ARCHITECTURE.md §45).
const domainProvider = new MockDomainProvider();
const domains = new PrismaCustomDomainRepository();

const registerDomain = new RegisterCustomDomainUseCase(domains, domainProvider);
const verifyDomain = new VerifyCustomDomainUseCase(domains, domainProvider);
const listDomains = new ListDomainsUseCase(domains);

type WebsiteScopedParams = { workspaceId: string; websiteId: string };
type DomainParams = WebsiteScopedParams & { domainId: string };

// Mounted at /api/v1/workspaces/:workspaceId/websites/:websiteId/domains
export const domainsRouter = Router({ mergeParams: true });
domainsRouter.use(requireSession);

const registerSchema = z.object({ hostname: z.string().min(3) });

domainsRouter.post<WebsiteScopedParams>("/", async (req, res, next) => {
  try {
    await assertWebsiteAccess({ workspaceId: req.params.workspaceId, userId: req.userId!, websiteId: req.params.websiteId });
    const { hostname } = registerSchema.parse(req.body);
    const result = await registerDomain.execute({ websiteId: req.params.websiteId, hostname });
    auditBestEffort({ workspaceId: req.params.workspaceId, actorId: req.userId!, action: "DOMAIN_CONNECTED", resourceType: "Domain", resourceId: result.domainId, metadata: { hostname } });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

domainsRouter.get<WebsiteScopedParams>("/", async (req, res, next) => {
  try {
    await assertWebsiteAccess({ workspaceId: req.params.workspaceId, userId: req.userId!, websiteId: req.params.websiteId });
    res.json(await listDomains.execute(req.params.websiteId));
  } catch (err) {
    next(err);
  }
});

domainsRouter.post<DomainParams>("/:domainId/verify", async (req, res, next) => {
  try {
    await assertWebsiteAccess({ workspaceId: req.params.workspaceId, userId: req.userId!, websiteId: req.params.websiteId });
    const result = await verifyDomain.execute(req.params.domainId, req.params.websiteId);
    if (result.verified) {
      auditBestEffort({ workspaceId: req.params.workspaceId, actorId: req.userId!, action: "DOMAIN_VERIFIED", resourceType: "Domain", resourceId: req.params.domainId });
    }
    res.json(result);
  } catch (err) {
    next(err);
  }
});



