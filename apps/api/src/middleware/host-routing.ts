import http from "node:http";
import { Request, Response, NextFunction } from "express";
import { prisma } from "@sitedock/database";

/**
 * Hostname-based routing for tenant applications and static websites.
 *
 * Platform hostnames (`<label>.<baseDomain>`) are resolved from authoritative
 * database state:
 *
 * 1. Malformed labels are rejected with 400.
 * 2. A dynamic service is selected only by its globally unique `hostname` and
 *    only when status = LIVE and `active_deployment_id` points at a READY
 *    deployment with a RUNNING container instance. Failed, queued or merely
 *    built deployments are never selected.
 * 3. The request is proxied to the active instance's published runtime port.
 *    A stopped/unreachable runtime yields 502, never a different tenant.
 * 4. Static websites are rewritten to `/sites/:subdomain/...`.
 * 5. Verified custom domains are resolved from the `domains` table to their
 *    target service (or website). Pending/failed domains never route.
 * 6. Unknown hostnames return 404.
 *
 * This middleware is not public DNS/TLS verification: it verifies the actual
 * application routing contract (host header -> active runtime).
 */
const CONTROL_HOSTS = new Set(
  (process.env.SITEDOCK_CONTROL_HOSTS ?? "api,www,admin,app,portal")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
);

const BASE_DOMAIN = (process.env.SITEDOCK_BASE_DOMAIN ?? "sitedock.local")
  .toLowerCase()
  .replace(/\.$/, "");

function isMalformedSubdomain(subdomain: string): boolean {
  if (!subdomain || subdomain.length > 63) return true;
  if (subdomain.includes("\0") || subdomain.includes("/") || subdomain.includes("\\") || subdomain.includes("..")) {
    return true;
  }
  return !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(subdomain);
}

function proxyToRuntime(req: Request, res: Response, hostPort: number): void {
  const options: http.RequestOptions = {
    hostname: "127.0.0.1",
    port: hostPort,
    path: req.url,
    method: req.method,
    headers: {
      ...req.headers,
      host: req.headers.host,
      "x-forwarded-for": req.socket.remoteAddress,
      "x-forwarded-proto": req.protocol,
      "x-forwarded-host": req.headers.host,
    },
    timeout: 30_000,
  };

  const proxyReq = http.request(options, (targetRes) => {
    if (res.headersSent) {
      targetRes.destroy();
      return;
    }
    res.writeHead(targetRes.statusCode ?? 200, targetRes.headers);
    targetRes.pipe(res);
  });

  proxyReq.on("timeout", () => {
    proxyReq.destroy();
    if (!res.headersSent) {
      res.status(504).json({
        code: "GATEWAY_TIMEOUT",
        message: "Application runtime request timed out",
        details: null,
      });
    }
  });

  proxyReq.on("error", () => {
    if (!res.headersSent) {
      res.status(502).json({
        code: "BAD_GATEWAY",
        message: "Application runtime is stopped or unreachable",
        details: null,
      });
    }
  });

  if (req.method !== "GET" && req.method !== "HEAD") {
    req.pipe(proxyReq);
  } else {
    proxyReq.end();
  }
}

async function proxyService(
  req: Request,
  res: Response,
  service: { id: string; status: string; activeDeploymentId: string | null; hostname: string },
  displayName: string
): Promise<void> {
  if (service.status !== "LIVE" || !service.activeDeploymentId) {
    res.status(503).json({
      code: "SERVICE_UNAVAILABLE",
      message: `Service '${displayName}' has no active healthy deployment (status: ${service.status})`,
      details: null,
    });
    return;
  }

  const active = await prisma.serviceDeployment.findFirst({
    where: {
      id: service.activeDeploymentId,
      serviceId: service.id,
      status: "READY",
    },
    select: {
      id: true,
      instances: {
        where: { status: "RUNNING", serviceId: service.id },
        orderBy: { startedAt: "desc" },
        take: 1,
        select: { containerId: true, hostPort: true },
      },
    },
  });

  const instance = active?.instances[0];
  if (!active || !instance?.hostPort) {
    res.status(503).json({
      code: "SERVICE_UNAVAILABLE",
      message: `Service '${displayName}' has no running runtime instance`,
      details: null,
    });
    return;
  }

  proxyToRuntime(req, res, instance.hostPort);
}

function serveStaticWebsite(
  req: Request,
  res: Response,
  next: NextFunction,
  website: { subdomain: string; status: string }
): void {
  if (website.status !== "LIVE") {
    res.status(404).json({
      code: "NOT_FOUND",
      message: "Website is not live",
      details: null,
    });
    return;
  }
  if (!req.url.startsWith("/sites/")) {
    const suffix = req.url === "/" ? "" : req.url;
    req.url = `/sites/${website.subdomain}${suffix.startsWith("/") ? suffix : "/" + suffix}`;
  }
  next();
}

async function routeCustomDomain(
  req: Request,
  res: Response,
  next: NextFunction,
  host: string
): Promise<void> {
  if (!/^[a-z0-9.-]+$/.test(host) || host.includes("..")) {
    res.status(400).json({
      code: "MALFORMED_HOSTNAME",
      message: "Hostname is malformed",
      details: null,
    });
    return;
  }

  const domain = await prisma.domain.findUnique({
    where: { hostname: host },
    select: {
      id: true,
      status: true,
      serviceId: true,
      website: { select: { subdomain: true, status: true } },
    },
  });

  if (!domain || domain.status !== "VERIFIED") {
    res.status(404).json({
      code: "NOT_FOUND",
      message: `Unknown hostname '${host}'`,
      details: null,
    });
    return;
  }

  if (domain.serviceId) {
    const service = await prisma.service.findUnique({
      where: { id: domain.serviceId },
      select: { id: true, status: true, activeDeploymentId: true, hostname: true },
    });
    if (!service) {
      res.status(404).json({ code: "NOT_FOUND", message: `Domain '${host}' has no target service`, details: null });
      return;
    }
    await proxyService(req, res, service, host);
    return;
  }

  serveStaticWebsite(req, res, next, domain.website);
}

export async function hostRoutingMiddleware(req: Request, res: Response, next: NextFunction) {
  const host = (req.headers.host ?? "").split(":")[0]?.toLowerCase() ?? "";
  if (!host || host === BASE_DOMAIN || host === "localhost" || host === "127.0.0.1" || host === "[::1]") {
    return next();
  }

  try {
    if (!host.endsWith(`.${BASE_DOMAIN}`)) {
      await routeCustomDomain(req, res, next, host);
      return;
    }

    const subdomain = host.slice(0, host.length - BASE_DOMAIN.length - 1);
    if (isMalformedSubdomain(subdomain)) {
      res.status(400).json({
        code: "MALFORMED_HOSTNAME",
        message: `Hostname label '${subdomain}' is malformed or invalid`,
        details: null,
      });
      return;
    }

    if (CONTROL_HOSTS.has(subdomain)) {
      return next();
    }

    // 0. Preview hostnames are globally unique and resolve only to a preview's
    // active (health-verified) revision. Cleanup disables routing immediately;
    // a preview can never fall through to another tenant's service or website.
    const preview = await prisma.preview.findUnique({
      where: { hostname: subdomain },
      select: { id: true, websiteId: true, status: true, deploymentId: true, cleanupStatus: true },
    });

    if (preview) {
      if (preview.cleanupStatus !== "NONE" || preview.status === "CANCELED") {
        res.status(404).json({
          code: "NOT_FOUND",
          message: `Preview '${subdomain}' is no longer available`,
          details: null,
        });
        return;
      }

      if (!preview.deploymentId) {
        res.status(503).json({
          code: "PREVIEW_UNAVAILABLE",
          message: `Preview '${subdomain}' has no healthy revision yet`,
          details: null,
        });
        return;
      }

      const revision = await prisma.previewRevision.findFirst({
        where: { id: preview.deploymentId, previewId: preview.id, status: "READY" },
        select: { id: true, containerId: true, hostPort: true },
      });

      if (!revision?.hostPort) {
        res.status(503).json({
          code: "PREVIEW_UNAVAILABLE",
          message: `Preview '${subdomain}' has no running revision`,
          details: null,
        });
        return;
      }

      proxyToRuntime(req, res, revision.hostPort);
      return;
    }

    // 1. Authoritative dynamic service lookup by globally unique hostname.
    const service = await prisma.service.findUnique({
      where: { hostname: subdomain },
      select: { id: true, status: true, activeDeploymentId: true, hostname: true },
    });

    if (service) {
      await proxyService(req, res, service, subdomain);
      return;
    }

    // 2. Static website delivery.
    const website = await prisma.website.findUnique({
      where: { subdomain },
      select: { id: true, subdomain: true, status: true },
    });

    if (website) {
      serveStaticWebsite(req, res, next, website);
      return;
    }

    // 3. Unknown hostname.
    res.status(404).json({
      code: "NOT_FOUND",
      message: `Unknown hostname '${subdomain}.${BASE_DOMAIN}'`,
      details: null,
    });
  } catch (err) {
    next(err);
  }
}
