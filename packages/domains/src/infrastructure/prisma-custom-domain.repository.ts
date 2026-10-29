import { prisma } from "@sitedock/database";
import { DomainName, WebsiteId } from "@sitedock/shared";
import { CustomDomain } from "../domain/custom-domain.entity";
import { CustomDomainRepository, ExpiringSslDomainSnapshot } from "../domain/ports";

type DomainRow = {
  id: string;
  websiteId: string;
  serviceId: string | null;
  hostname: string;
  status: string;
  provider: string;
  ownershipProofToken: string | null;
  providerRecordId: string | null;
  dnsRecordType: string | null;
  dnsRecordName: string | null;
  dnsRecordValue: string | null;
  autoManaged: boolean;
  routingOk: boolean;
  routingCheckedAt: Date | null;
  routingObserved: string[];
  lastError: string | null;
  verificationAttempts: number;
  sslStatus: string;
  sslError: string | null;
  verifiedAt: Date | null;
  sslIssuedAt: Date | null;
  sslExpiresAt: Date | null;
  createdAt: Date;
};

function toDomain(row: DomainRow): CustomDomain {
  return CustomDomain.hydrate({
    id: row.id,
    websiteId: WebsiteId(row.websiteId),
    serviceId: row.serviceId,
    hostname: DomainName.create(row.hostname),
    status: row.status as CustomDomain["status"],
    provider: row.provider,
    ownershipProofToken: row.ownershipProofToken,
    providerRecordId: row.providerRecordId,
    dnsRecordType: row.dnsRecordType,
    dnsRecordName: row.dnsRecordName,
    dnsRecordValue: row.dnsRecordValue,
    autoManaged: row.autoManaged,
    routingOk: row.routingOk,
    routingCheckedAt: row.routingCheckedAt,
    routingObserved: row.routingObserved,
    lastError: row.lastError,
    verificationAttempts: row.verificationAttempts,
    sslStatus: row.sslStatus as CustomDomain["sslStatus"],
    sslError: row.sslError,
    verifiedAt: row.verifiedAt,
    sslIssuedAt: row.sslIssuedAt,
    sslExpiresAt: row.sslExpiresAt,
    createdAt: row.createdAt,
  });
}

export class PrismaCustomDomainRepository implements CustomDomainRepository {
  async findByIdForWebsite(id: string, websiteId: WebsiteId): Promise<CustomDomain | null> {
    const row = await prisma.domain.findFirst({ where: { id, websiteId } });
    return row ? toDomain(row as DomainRow) : null;
  }

  async findByHostname(hostname: string): Promise<CustomDomain | null> {
    const row = await prisma.domain.findUnique({ where: { hostname } });
    return row ? toDomain(row as DomainRow) : null;
  }

  async listByWebsite(websiteId: WebsiteId): Promise<CustomDomain[]> {
    const rows = await prisma.domain.findMany({ where: { websiteId }, orderBy: { createdAt: "desc" } });
    return rows.map((row) => toDomain(row as DomainRow));
  }

  async listByStatus(status: CustomDomain["status"]): Promise<CustomDomain[]> {
    const rows = await prisma.domain.findMany({ where: { status } });
    return rows.map((row) => toDomain(row as DomainRow));
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

  async deleteByIdForWebsite(id: string, websiteId: WebsiteId): Promise<void> {
    await prisma.domain.deleteMany({ where: { id, websiteId } });
  }

  async save(domain: CustomDomain): Promise<void> {
    const data = {
      websiteId: domain.websiteId,
      serviceId: domain.serviceId,
      hostname: domain.hostname.value,
      status: domain.status,
      provider: domain.provider,
      ownershipProofToken: domain.ownershipProofToken,
      providerRecordId: domain.providerRecordId,
      dnsRecordType: domain.dnsRecordType,
      dnsRecordName: domain.dnsRecordName,
      dnsRecordValue: domain.dnsRecordValue,
      autoManaged: domain.autoManaged,
      routingOk: domain.routingOk,
      routingCheckedAt: domain.routingCheckedAt,
      routingObserved: domain.routingObserved,
      lastError: domain.lastError,
      verificationAttempts: domain.verificationAttempts,
      sslStatus: domain.sslStatus,
      sslError: domain.sslError,
      verifiedAt: domain.verifiedAt,
      sslIssuedAt: domain.sslIssuedAt,
      sslExpiresAt: domain.sslExpiresAt,
    };

    await prisma.domain.upsert({
      where: { id: domain.id },
      create: { id: domain.id, ...data },
      update: data,
    });
  }
}
