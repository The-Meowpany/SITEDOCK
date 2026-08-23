import { prisma } from "@sitedock/database";
import { WorkspaceId } from "@sitedock/shared";
import { ConnectedAccountRecord, ConnectedAccountRepository } from "../application/merchant-onboarding.use-cases";

function toDomain(row: {
  id: string;
  workspaceId: string;
  provider: string;
  externalAccountId: string;
  status: string;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  onboardedAt: Date | null;
}): ConnectedAccountRecord {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    provider: row.provider,
    externalAccountId: row.externalAccountId,
    status: row.status as ConnectedAccountRecord["status"],
    chargesEnabled: row.chargesEnabled,
    payoutsEnabled: row.payoutsEnabled,
    onboardedAt: row.onboardedAt,
  };
}

export class PrismaConnectedAccountRepository implements ConnectedAccountRepository {
  async findByWorkspaceId(workspaceId: WorkspaceId): Promise<ConnectedAccountRecord | null> {
    const row = await prisma.connectedAccount.findUnique({ where: { workspaceId } });
    return row ? toDomain(row) : null;
  }

  async findByExternalAccountId(externalAccountId: string): Promise<ConnectedAccountRecord | null> {
    const row = await prisma.connectedAccount.findUnique({ where: { externalAccountId } });
    return row ? toDomain(row) : null;
  }

  async save(account: ConnectedAccountRecord): Promise<void> {
    const data = {
      workspaceId: account.workspaceId,
      provider: account.provider,
      externalAccountId: account.externalAccountId,
      status: account.status,
      chargesEnabled: account.chargesEnabled,
      payoutsEnabled: account.payoutsEnabled,
      onboardedAt: account.onboardedAt,
    };
    await prisma.connectedAccount.upsert({
      where: { id: account.id },
      create: data,
      update: {
        status: account.status,
        chargesEnabled: account.chargesEnabled,
        payoutsEnabled: account.payoutsEnabled,
        onboardedAt: account.onboardedAt,
        externalAccountId: account.externalAccountId,
      },
    });
  }
}
