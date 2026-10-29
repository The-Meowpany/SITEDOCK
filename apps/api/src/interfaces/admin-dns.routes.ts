import { Router } from "express";
import { z } from "zod";
import { createDnsheDomainProviderFromEnv, DnsheDomainProvider } from "@sitedock/domains";
import { requireSession } from "../middleware/require-session";
import { requirePlatformAdmin } from "../middleware/require-platform-admin";
import { auditBestEffort } from "../audit";

/**
 * Platform-admin DNSHE controls. Every route is read-only unless the caller
 * sends `apply: true`; all writes are audited and never overwrite existing
 * records. Credentials never appear in responses or logs.
 *
 * Mounted at /api/v1/admin/dns.
 */
export const adminDnsRouter = Router();
adminDnsRouter.use(requireSession, requirePlatformAdmin);

function providerOrNull(): DnsheDomainProvider | null {
  return createDnsheDomainProviderFromEnv();
}

adminDnsRouter.get("/status", async (_req, res, next) => {
  try {
    const provider = providerOrNull();
    if (!provider) {
      res.json({
        configured: false,
        baseDomain: process.env.SITEDOCK_BASE_DOMAIN ?? null,
        publicIpConfigured: Boolean(process.env.SITEDOCK_PUBLIC_IP),
        message: "DNSHE_API_KEY/DNSHE_API_SECRET are not configured",
      });
      return;
    }

    const account = await provider.describeAccount();
    res.json({
      configured: true,
      baseDomain: account.baseDomain,
      zoneFound: account.zone !== null,
      zone: account.zone
        ? {
            id: account.zone.id,
            fullDomain: account.zone.full_domain,
            status: account.zone.status,
            expiresAt: account.zone.expires_at ?? null,
          }
        : null,
      zoneCount: account.zoneCount,
      publicIpConfigured: Boolean(process.env.SITEDOCK_PUBLIC_IP),
      recordCount: account.records.length,
      records: account.records.map((record) => ({
        name: record.name,
        type: record.type,
        value: record.content,
        ttl: record.ttl,
      })),
    });
  } catch (err) {
    next(err);
  }
});

const provisionSchema = z.object({
  apply: z.boolean().optional().default(false),
  publicIp: z.string().trim().optional(),
});

adminDnsRouter.post("/provision-base", async (req, res, next) => {
  try {
    const provider = providerOrNull();
    if (!provider) {
      res.status(503).json({
        code: "DNSHE_NOT_CONFIGURED",
        message: "DNSHE_API_KEY and DNSHE_API_SECRET are required",
      });
      return;
    }

    const { apply, publicIp } = provisionSchema.parse(req.body ?? {});
    const ip = publicIp || process.env.SITEDOCK_PUBLIC_IP?.trim();
    if (!ip) {
      res.status(400).json({
        code: "PUBLIC_IP_REQUIRED",
        message: "Provide publicIp or configure SITEDOCK_PUBLIC_IP",
      });
      return;
    }

    const result = await provider.provisionPlatformAddressRecords(ip, apply);
    if (result.applied) {
      auditBestEffort({
        workspaceId: null,
        actorId: req.userId!,
        action: "ADMIN_ACTION",
        resourceType: "DnsZone",
        resourceId: result.zone,
        metadata: { operation: "DNSHE_BASE_RECORDS_APPLIED", publicIp: ip },
      });
    }
    res.json(result);
  } catch (err) {
    next(err);
  }
});
