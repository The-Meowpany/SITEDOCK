import { prisma } from "@sitedock/database";
import { DomainName, WebsiteId } from "@sitedock/shared";
import { CustomDomain } from "../domain/custom-domain.entity";
import { CustomDomainRepository, ExpiringSslDomainSnapshot } from "../domain/ports";

type DomainRow = {
  id: string;
  websiteId: string;
  hostname: string;
  status: string;
  ownershipProofToken: string | null;
  verifiedAt: Date | null;
  sslIssuedAt: Date | null;
  sslExpiresAt: Date | null;
  createdAt: Date;
};

function toDomain(row: DomainRow): CustomDomain {
  return CustomDomain.hydrate({
    id: row.id,
    websiteId: WebsiteId(row.websiteId),
    hostname: DomainName.create(row.hostname),
    status: row.status as CustomDomain["status"],
    ownershipProofToken: row.ownershipProofToken,
    verifiedAt: row.verifiedAt,
    sslIssuedAt: row.sslIssuedAt,
    sslExpiresAt: row.sslExpiresAt,
    createdAt: row.createdAt,
  });
}

export class PrismaCustomDomainRepository implements CustomDomainRepository {
  async findByIdForWebsite(id: string, websiteId: WebsiteId): Promise<CustomDomain | null> {
    const row = await prisma.domain.findFirst({ where: { id, websiteId } });
    return row ? toDomain(row) : null;
  }

  async findByHostname(hostname: string): Promise<CustomDomain | null> {
    const row = await prisma.domain.findUnique({ where: { hostname } });
    return row ? toDomain(row) : null;
  }

  async listByWebsite(websiteId: WebsiteId): Promise<CustomDomain[]> {
    const rows = await prisma.domain.findMany({ where: { websiteId }, orderBy: { createdAt: "desc" } });
    return rows.map((row: DomainRow) => toDomain(row));
  }

  async listByStatus(status: CustomDomain["status"]): Promise<CustomDomain[]> {
    const rows = await prisma.domain.findMany({ where: { status } });
    return rows.map((row: DomainRow) => toDomain(row));
  }

  async listSslExpiringBefore(deadline: Date): Promise<ExpiringSslDomainSnapshot[]> {
    const rows = await prisma.domain.findMany({
      where: { status: "VERIFIED", sslExpiresAt: { lte: deadline } },
      orderBy: { sslExpiresAt: "asc" },
      select: {
        id: true,
        hostname: true,
        websiteId: true,
        website: { select: { workspaceId: true } },
        sslExpiresAt: true,
      },
    });
    return rows.map((r) => ({
      domainId: r.id,
      hostname: r.hostname,
      websiteId: r.websiteId,
      workspaceId: r.website.workspaceId,
      sslExpiresAt: r.sslExpiresAt!,
    }));
  }

  async save(domain: CustomDomain): Promise<void> {
    await prisma.domain.upsert({
      where: { id: domain.id },
      create: {
        id: domain.id,
        websiteId: domain.websiteId,
        hostname: domain.hostname.value,
        status: domain.status,
        ownershipProofToken: domain.ownershipProofToken,
        verifiedAt: domain.verifiedAt,
        sslIssuedAt: domain.sslIssuedAt,
        sslExpiresAt: domain.sslExpiresAt,
      },
      update: {
        status: domain.status,
        ownershipProofToken: domain.ownershipProofToken,
        verifiedAt: domain.verifiedAt,
        sslIssuedAt: domain.sslIssuedAt,
        sslExpiresAt: domain.sslExpiresAt,
      },
    });
  }
}
