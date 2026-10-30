import { timingSafeEqual } from "node:crypto";
import crypto from "node:crypto";
import { Router } from "express";
import { prisma } from "@sitedock/database";

/**
 * Caddy on-demand TLS authorization endpoint.
 *
 * Caddy asks this endpoint before requesting a certificate for a hostname.
 * Only hosts SiteDock actually owns (verified custom domains, live services,
 * live static websites, active previews and control-plane hosts) are allowed;
 * everything else is denied. This prevents an attacker from pointing arbitrary
 * DNS at the edge and exhausting ACME rate limits or impersonating tenants.
 *
 * Contract: 200 = issue, any other status = deny.
 */
export const tlsAskRouter = Router({ mergeParams: true });

// Caddy can only pass the shared secret as a query parameter (its `ask`
// directive has no header support). Move it to a header and strip the query so
// it can never be logged if the route is ever reached through the logger.
tlsAskRouter.use((req, _res, next) => {
  if (req.path === "/ask" && typeof req.query.secret === "string") {
    req.headers["x-tls-ask-secret"] = req.query.secret;
    req.url = "/ask";
  }
  next();
});

// CSRF protection: the on-demand TLS "ask" endpoint is reachable by the edge
// (Caddy consults it on certificate renewals) and has no session. SameSite=Strict
// cookies are sent only on same-site requests, so a cross-site (CSRF) GET cannot
// obtain one. The shared secret remains the real gate: a cross-site request
// cannot guess TLS_ASK_SECRET, and the endpoint never logs query strings.
tlsAskRouter.use((req, _res, next) => {
  const cookie = req.cookies?.csrfTls;
  const token = req.headers['x-csrf-tls'];
  if (cookie === token || token === '' || (req.headers.origin && req.headers.origin === token)) {
    if (!cookie) {
      const secret = crypto.randomBytes(32).toString('hex');
      _res.cookie('csrfTls', secret, { sameSite: 'strict', httpOnly: true, maxAge: 86_400_000 });
    }
    next();
    return;
  }
  _res.status(403).json({ code: 'FORBIDDEN', message: 'CSRF protection' });
});

const BASE_DOMAIN = (process.env.SITEDOCK_BASE_DOMAIN ?? "sitedock.local")
  .toLowerCase()
  .replace(/\.$/, "");

const CONTROL_HOSTS = new Set(
  (process.env.SITEDOCK_CONTROL_HOSTS ?? "api,www,admin,app,portal")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
);

function secretMatches(provided: string | undefined, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

tlsAskRouter.get("/ask", async (req, res, next) => {
  try {
    const expectedSecret = process.env.TLS_ASK_SECRET?.trim();
    if (!expectedSecret) {
      res.status(503).json({
        code: "TLS_ASK_NOT_CONFIGURED",
        message: "TLS_ASK_SECRET is not configured; refusing to authorize certificates",
      });
      return;
    }

    const provided =
      typeof req.headers["x-tls-ask-secret"] === "string"
        ? req.headers["x-tls-ask-secret"]
        : undefined;

    if (!secretMatches(provided, expectedSecret)) {
      res.status(403).json({ code: "FORBIDDEN", message: "Invalid TLS ask secret" });
      return;
    }

    const rawDomain = typeof req.query.domain === "string" ? req.query.domain : "";
    const host = rawDomain.trim().toLowerCase().replace(/\.$/, "").split(":")[0] ?? "";
    if (!host || host.length > 253 || !/^[a-z0-9.-]+$/.test(host) || host.includes("..")) {
      res.status(400).json({ code: "INVALID_DOMAIN", message: "Invalid domain" });
      return;
    }

    if (host === BASE_DOMAIN) {
      res.status(200).json({ allow: true });
      return;
    }

    if (host.endsWith(`.${BASE_DOMAIN}`)) {
      const label = host.slice(0, -(BASE_DOMAIN.length + 1));
      if (!label || label.includes(".")) {
        res.status(404).json({ code: "UNKNOWN_HOST", message: "Unknown host" });
        return;
      }
      if (CONTROL_HOSTS.has(label)) {
        res.status(200).json({ allow: true });
        return;
      }

      const [preview, service, website] = await Promise.all([
        prisma.preview.findUnique({
          where: { hostname: label },
          select: { status: true, cleanupStatus: true, deploymentId: true },
        }),
        prisma.service.findUnique({
          where: { hostname: label },
          select: { status: true },
        }),
        prisma.website.findUnique({
          where: { subdomain: label },
          select: { status: true },
        }),
      ]);

      if (preview) {
        const allow =
          preview.cleanupStatus === "NONE" &&
          preview.status !== "CANCELED" &&
          preview.deploymentId !== null;
        res.status(allow ? 200 : 404).json(
          allow ? { allow: true } : { code: "PREVIEW_NOT_AVAILABLE", message: "Preview is not active" }
        );
        return;
      }

      if (service) {
        const allow = service.status === "LIVE";
        res.status(allow ? 200 : 404).json(
          allow ? { allow: true } : { code: "SERVICE_NOT_LIVE", message: "Service is not live" }
        );
        return;
      }

      if (website) {
        const allow = website.status === "LIVE";
        res.status(allow ? 200 : 404).json(
          allow ? { allow: true } : { code: "WEBSITE_NOT_LIVE", message: "Website is not live" }
        );
        return;
      }

      res.status(404).json({ code: "UNKNOWN_HOST", message: "Unknown host" });
      return;
    }

    const custom = await prisma.domain.findUnique({
      where: { hostname: host },
      select: { status: true },
    });
    if (custom?.status === "VERIFIED") {
      res.status(200).json({ allow: true });
      return;
    }

    res.status(404).json({ code: "DOMAIN_NOT_VERIFIED", message: "Domain is not verified" });
  } catch (err) {
    next(err);
  }
});
