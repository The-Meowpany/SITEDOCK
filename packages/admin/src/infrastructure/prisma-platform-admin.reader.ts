import { prisma } from "@sitedock/database";
import { PlatformAdminReader } from "../domain/ports";

/**
 * Platform-wide read model. Deliberately NOT workspace-scoped — this is the
 * one reader in the codebase that crosses tenants, and it may only ever be
 * mounted behind requirePlatformAdmin (see domain/ports.ts).
 */
export class PrismaPlatformAdminReader implements PlatformAdminReader {
  async getOverview() {
    const in30d = new Date();
    in30d.setDate(in30d.getDate() - 30);

    const [usersTotal, workspacesTotal, websitesByStatusRows, activeSubs, failedPayments, deployments] =
      await Promise.all([
        prisma.user.count(),
        prisma.workspace.count(),
        prisma.website.groupBy({ by: ["status"], _count: { _all: true } }),
        prisma.subscription.findMany({
          where: { status: "ACTIVE" },
          select: { priceCents: true, currency: true, billingInterval: true },
        }),
        prisma.payment.count({
          where: { status: "FAILED", createdAt: { gte: in30d } },
        }),
        prisma.deployment.aggregate({ _count: { _all: true }, _sum: { sizeBytes: true } }),
      ]);

    const websitesByStatus: Record<string, number> = {};
    for (const row of websitesByStatusRows) {
      websitesByStatus[row.status] = row._count._all;
    }

    return {
      usersTotal,
      workspacesTotal,
      websitesByStatus,
      activeSubscriptionPrices: activeSubs.map((s) => ({
        priceCents: s.priceCents,
        currency: s.currency,
        billingInterval: s.billingInterval,
      })),
      activeSubscriptionCount: activeSubs.length,
      failedPaymentsLast30Days: failedPayments,
      deploymentsTotal: deployments._count._all,
      storageBytes: Number(deployments._sum.sizeBytes ?? 0),
    };
  }

  async listTenants(limit: number) {
    const workspaces = await prisma.workspace.findMany({
      take: limit,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        slug: true,
        createdAt: true,
        _count: { select: { websites: true } },
      },
    });
    // Active subscriptions per tenant requires going through Website; one
    // flat query + in-memory count instead of N+1.
    const wsIds = workspaces.map((w) => w.id);
    const activeSubWorkspaces = await prisma.subscription.findMany({
      where: { status: "ACTIVE", website: { workspaceId: { in: wsIds } } },
      select: { website: { select: { workspaceId: true } } },
    });
    const activeCountPerWorkspace = new Map<string, number>();
    for (const sub of activeSubWorkspaces) {
      const wsId = sub.website.workspaceId;
      activeCountPerWorkspace.set(wsId, (activeCountPerWorkspace.get(wsId) ?? 0) + 1);
    }

    return workspaces.map((w) => ({
      id: w.id,
      name: w.name,
      slug: w.slug,
      websiteCount: w._count.websites,
      activeSubscriptionCount: activeCountPerWorkspace.get(w.id) ?? 0,
      createdAt: w.createdAt,
    }));
  }

  async listUsers(limit: number) {
    const rows = await prisma.user.findMany({
      take: limit,
      orderBy: { createdAt: "desc" },
      select: { id: true, email: true, fullName: true, platformRole: true, suspendedAt: true, createdAt: true },
    });
    return rows;
  }

  async listRecentWebsites(limit: number) {
    const rows = await prisma.website.findMany({
      take: limit,
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        name: true,
        subdomain: true,
        status: true,
        workspaceId: true,
        workspace: { select: { name: true } },
        updatedAt: true,
      },
    });
    return rows.map((w) => ({ ...w, workspaceName: w.workspace.name }));
  }

  async listRecentPayments(limit: number) {
    return prisma.payment.findMany({
      take: limit,
      orderBy: { createdAt: "desc" },
      select: { id: true, status: true, amountCents: true, currency: true, provider: true, createdAt: true },
    });
  }

  async listWebhookEvents(limit: number) {
    return prisma.paymentEvent.findMany({
      take: limit,
      orderBy: { receivedAt: "desc" },
      select: { id: true, provider: true, eventType: true, processingStatus: true, receivedAt: true },
    });
  }

  async findWebsiteForAdmin(websiteId: string) {
    const row = await prisma.website.findUnique({
      where: { id: websiteId },
      select: { id: true, workspaceId: true, name: true },
    });
    return row ?? null;
  }
}
