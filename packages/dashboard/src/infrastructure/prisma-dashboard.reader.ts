import { WorkspaceId } from "@sitedock/shared";
import { prisma } from "@sitedock/database";
import { DashboardReader, DeploymentStats } from "../domain/ports";

/**
 * Prisma implementation of the dashboard read model. Every query is filtered
 * by workspaceId — for Subscription/Payment/Deployment that means filtering
 * through their Website relation, which is where the tenant boundary lives.
 */
export class PrismaDashboardReader implements DashboardReader {
  async listSubscriptionSnapshots(workspaceId: WorkspaceId) {
    const rows = await prisma.subscription.findMany({
      where: { website: { workspaceId } },
      select: {
        status: true,
        websiteId: true,
        priceCents: true,
        currency: true,
        billingInterval: true,
        createdAt: true,
        cancellationDate: true,
      },
    });
    return rows.map((r) => ({
      status: r.status,
      websiteId: r.websiteId,
      priceCents: r.priceCents,
      currency: r.currency,
      billingInterval: r.billingInterval,
      createdAt: r.createdAt,
      cancellationDate: r.cancellationDate,
    }));
  }

  async listWebsiteSnapshots(workspaceId: WorkspaceId) {
    const rows = await prisma.website.findMany({
      where: { workspaceId },
      select: { id: true, name: true, status: true, clientId: true },
    });
    return rows;
  }

  async listClientSnapshots(workspaceId: WorkspaceId) {
    const rows = await prisma.client.findMany({
      where: { workspaceId },
      select: { id: true, fullName: true, email: true },
    });
    return rows;
  }

  async getDeploymentStats(workspaceId: WorkspaceId, since30Days: Date): Promise<DeploymentStats> {
    const [totalAgg, recent] = await Promise.all([
      prisma.deployment.aggregate({
        _count: { _all: true },
        _sum: { sizeBytes: true },
        where: { website: { workspaceId } },
      }),
      prisma.deployment.count({
        where: { website: { workspaceId }, createdAt: { gte: since30Days } },
      }),
    ]);
    return {
      total: totalAgg._count._all,
      last30Days: recent,
      storageBytes: Number(totalAgg._sum.sizeBytes ?? 0),
    };
  }

  async countFailedPaymentsLast30Days(workspaceId: WorkspaceId, since30Days: Date) {
    return prisma.payment.count({
      where: {
        status: "FAILED",
        createdAt: { gte: since30Days },
        invoice: { subscription: { website: { workspaceId } } },
      },
    });
  }

  async listRecentFailedPayments(workspaceId: WorkspaceId, limit: number) {
    const rows = await prisma.payment.findMany({
      where: {
        status: "FAILED",
        invoice: { subscription: { website: { workspaceId } } },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: { amountCents: true, currency: true, createdAt: true },
    });
    return rows;
  }

  async listSuccessfulPaymentsSince(workspaceId: WorkspaceId, since: Date) {
    const rows = await prisma.payment.findMany({
      where: {
        status: "SUCCEEDED",
        createdAt: { gte: since },
        invoice: { subscription: { website: { workspaceId } } },
      },
      select: { amountCents: true, currency: true, createdAt: true },
    });
    return rows;
  }

  async countOpenMaintenanceRequests(workspaceId: WorkspaceId) {
    return prisma.maintenanceRequest.count({
      where: {
        status: { in: ["OPEN", "IN_PROGRESS", "WAITING_CLIENT", "PENDING_PAYMENT", "PAID"] },
        website: { workspaceId },
      },
    });
  }
}
