import { Router } from "express";
import { z } from "zod";
import { prisma } from "@sitedock/database";
import { NotFoundError } from "@sitedock/shared";
import {
  CheckCustomDomainUseCase,
  DeleteCustomDomainUseCase,
  DomainProvider,
  ListDomainsUseCase,
  MockDomainProvider,
  PrismaCustomDomainRepository,
  RegisterCustomDomainUseCase,
  VerifyCustomDomainUseCase,
  createDnsheDomainProviderFromEnv,
  isManagedDomainProvider,
} from "@sitedock/domains";
import { requireSession } from "../middleware/require-session";
import { assertWebsiteAccess } from "../middleware/access-control";
import { auditBestEffort } from "../audit";

/**
 * Provider selection is explicit: `DOMAIN_PROVIDER=dnshe` without credentials
 * is a startup failure (never a silent mock fallback in production). When the
 * variable is unset, DNSHE is used if configured, otherwise the mock provider
 * keeps local/demo environments functional.
 */
function selectDomainProvider(): DomainProvider {
  const dnshe = createDnsheDomainProviderFromEnv();
  const requested = process.env.DOMAIN_PROVIDER?.trim().toLowerCase();

  if (requested === "dnshe" && !dnshe) {
    throw new Error(
      "DOMAIN_PROVIDER=dnshe requires DNSHE_API_KEY and DNSHE_API_SECRET"
    );
  }
  if (requested === "mock") return new MockDomainProvider();
  return dnshe ?? new MockDomainProvider();
}

// Singleton per process — same rationale as MockPaymentProvider (docs/ARCHITECTURE.md §45).
const domainProvider = selectDomainProvider();
const domains = new PrismaCustomDomainRepository();

const registerDomain = new RegisterCustomDomainUseCase(domains, domainProvider);
const verifyDomain = new VerifyCustomDomainUseCase(domains, domainProvider);
const checkDomain = new CheckCustomDomainUseCase(domains, domainProvider);
const listDomains = new ListDomainsUseCase(domains, domainProvider);
const deleteDomain = new DeleteCustomDomainUseCase(domains, domainProvider);

type WebsiteScopedParams = { workspaceId: string; websiteId: string };
type DomainParams = WebsiteScopedParams & { domainId: string };

// Mounted at /api/v1/workspaces/:workspaceId/websites/:websiteId/domains
export const domainsRouter = Router({ mergeParams: true });
domainsRouter.use(requireSession);

const registerSchema = z.object({
  hostname: z
    .string()
    .min(3)
    .max(253)
    .transform((value) => value.trim().toLowerCase().replace(/\.$/, "")),
  serviceId: z.string().uuid().nullish(),
  autoManage: z.boolean().optional(),
});

async function assertServiceBelongsToWebsite(serviceId: string, websiteId: string): Promise<void> {
  const service = await prisma.service.findFirst({
    where: {
      id: serviceId,
      project: { websites: { some: { id: websiteId } } },
    },
    select: { id: true },
  });
  if (!service) {
    throw new NotFoundError("Service", serviceId);
  }
}

domainsRouter.get<WebsiteScopedParams>("/", async (req, res, next) => {
  try {
    await assertWebsiteAccess({ workspaceId: req.params.workspaceId, userId: req.userId!, websiteId: req.params.websiteId });
    const list = await listDomains.execute(req.params.websiteId);
    res.json({
      provider: domainProvider.name ?? "manual",
      managed: isManagedDomainProvider(domainProvider),
      domains: list,
    });
  } catch (err) {
    next(err);
  }
});

domainsRouter.post<WebsiteScopedParams>("/", async (req, res, next) => {
  try {
    await assertWebsiteAccess({
      workspaceId: req.params.workspaceId,
      userId: req.userId!,
      websiteId: req.params.websiteId,
      requiredRoles: ["OWNER", "ADMIN", "DEVELOPER"],
    });
    const { hostname, serviceId, autoManage } = registerSchema.parse(req.body);
    if (serviceId) await assertServiceBelongsToWebsite(serviceId, req.params.websiteId);

    const result = await registerDomain.execute({
      websiteId: req.params.websiteId,
      hostname,
      serviceId: serviceId ?? null,
      autoManage: autoManage ?? false,
    });
    auditBestEffort({
      workspaceId: req.params.workspaceId,
      actorId: req.userId!,
      action: "DOMAIN_CONNECTED",
      resourceType: "Domain",
      resourceId: result.domainId,
      metadata: { hostname, autoManaged: result.autoManaged },
    });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

domainsRouter.post<DomainParams>("/:domainId/verify", async (req, res, next) => {
  try {
    await assertWebsiteAccess({
      workspaceId: req.params.workspaceId,
      userId: req.userId!,
      websiteId: req.params.websiteId,
      requiredRoles: ["OWNER", "ADMIN", "DEVELOPER"],
    });
    const result = await verifyDomain.execute(req.params.domainId, req.params.websiteId);
    if (result.verified) {
      auditBestEffort({ workspaceId: req.params.workspaceId, actorId: req.userId!, action: "DOMAIN_VERIFIED", resourceType: "Domain", resourceId: req.params.domainId });
    }
    res.json(result);
  } catch (err) {
    next(err);
  }
});

domainsRouter.post<DomainParams>("/:domainId/check", async (req, res, next) => {
  try {
    await assertWebsiteAccess({
      workspaceId: req.params.workspaceId,
      userId: req.userId!,
      websiteId: req.params.websiteId,
      requiredRoles: ["OWNER", "ADMIN", "DEVELOPER"],
    });
    const result = await checkDomain.execute(req.params.domainId, req.params.websiteId);
    auditBestEffort({
      workspaceId: req.params.workspaceId,
      actorId: req.userId!,
      action: "DOMAIN_CHECKED",
      resourceType: "Domain",
      resourceId: req.params.domainId,
      metadata: { routingOk: result.routingOk, sslStatus: result.sslStatus },
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

domainsRouter.delete<DomainParams>("/:domainId", async (req, res, next) => {
  try {
    await assertWebsiteAccess({
      workspaceId: req.params.workspaceId,
      userId: req.userId!,
      websiteId: req.params.websiteId,
      requiredRoles: ["OWNER", "ADMIN", "DEVELOPER"],
    });
    const result = await deleteDomain.execute(req.params.domainId, req.params.websiteId);
    auditBestEffort({
      workspaceId: req.params.workspaceId,
      actorId: req.userId!,
      action: "DOMAIN_DISCONNECTED",
      resourceType: "Domain",
      resourceId: req.params.domainId,
      metadata: { providerRecordRemoved: result.providerRecordRemoved },
    });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
