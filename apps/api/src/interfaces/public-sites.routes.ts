import { Router } from "express";
import { NotFoundError } from "@sitedock/shared";
import { StorageProvider } from "@sitedock/deployment";
import { PrismaWebsiteRepository as PrismaWebsiteRepo } from "@sitedock/website";

/**
 * Public static website serving.
 *
 * Route: GET /sites/:subdomain/:path(*)
 *
 * Serves the immutable files of a website's currently published deployment.
 * Design constraints:
 * - Only PUBLISHED deployments of LIVE websites are served.
 * - Suspended, archived, deleted, or draft websites return 404.
 * - Unpublished deployments, backups, and internal metadata are never exposed.
 * - Path traversal and encoded traversal are rejected.
 * - Each tenant's deployments are isolated by websiteId + storagePath.
 * - The route is mounted OUTSIDE /api/v1 so it is never behind auth gates;
 *   authorization is enforced by website status (LIVE only) + deployment publication state.
 *
 * @param storage - Shared StorageProvider instance (must be the same one used
 *   for deployment uploads so uploaded files are publicly retrievable).
 * @param websites - PrismaWebsiteRepository instance.
 */
export function createPublicSitesRouter(
  storage: StorageProvider,
  websites: PrismaWebsiteRepo
) {
  const router = Router();

  // MIME type mapping for static assets served publicly.
  function contentTypeFor(path: string): string {
    const ext = path.slice(path.lastIndexOf(".")).toLowerCase();
    const map: Record<string, string> = {
      ".html": "text/html; charset=utf-8",
      ".htm": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "application/javascript",
      ".mjs": "application/javascript",
      ".json": "application/json",
      ".svg": "image/svg+xml",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".gif": "image/gif",
      ".webp": "image/webp",
      ".ico": "image/x-icon",
      ".woff": "font/woff",
      ".woff2": "font/woff2",
      ".ttf": "font/ttf",
      ".otf": "font/otf",
      ".eot": "application/vnd.ms-fontobject",
      ".txt": "text/plain; charset=utf-8",
      ".xml": "application/xml",
      ".webmanifest": "application/manifest+json",
      ".map": "application/json",
    };
    return map[ext] ?? "application/octet-stream";
  }

  // Cache policy: HTML documents are mutable (publication/rollback changes them),
  // so they get a short TTL. Versioned static assets (hash-free but deployed as
  // immutable deployment artifacts) get a long immutable cache.
  function cachePolicyFor(path: string): string {
    const ext = path.slice(path.lastIndexOf(".")).toLowerCase();
    const isHtml = ext === ".html" || ext === ".htm";
    if (isHtml) {
      // HTML must revalidate so publication/rollback is visible promptly.
      return "public, max-age=60, must-revalidate";
    }
    return "public, max-age=31536000, immutable";
  }

  function isUnsafePath(path: string): boolean {
    if (path.includes("\0")) return true;
    if (path.startsWith("/")) return true;
    const normalized = path.replace(/\\/g, "/");
    if (normalized.startsWith("..") || normalized.includes("/../") || normalized === "..") return true;
    return false;
  }

  router.get<{ subdomain: string; path: string[] }>(
    "/:subdomain/:path(*)",
    async (req, res, next) => {
      try {
        const subdomain = req.params.subdomain;

        // Reject unsafe subdomains before touching the database:
        // null bytes, path separators, traversal, absolute paths.
        if (isUnsafePath(subdomain)) {
          throw new NotFoundError("Not found", "NOT_FOUND");
        }

        // Normalize path param: Express may return string, string[], or undefined
        // depending on the number of URL segments.
        const rawPath = req.params.path as unknown as string | string[] | undefined;
        const pathParts: string[] = Array.isArray(rawPath)
          ? rawPath
          : typeof rawPath === "string"
            ? rawPath.split("/").filter(Boolean)
            : [];

        const requestedPath = pathParts
          .map((segment) => {
            if (isUnsafePath(segment)) {
              throw new NotFoundError("Not found", "NOT_FOUND");
            }
            return segment;
          })
          .join("/");

        let website;
        try {
          website = await websites.findBySubdomain(subdomain);
        } catch (dbErr) {
          // Database unavailable — fail closed with 503, consistent with
          // /health/ready. Never leak raw Prisma errors to the client.
          res.status(503).json({ code: "DATABASE_UNAVAILABLE", message: "Database unavailable", details: null });
          return;
        }

        if (!website) {
          throw new NotFoundError("Website", subdomain);
        }

        // Only LIVE websites serve publicly. All other statuses return 404.
        if (website.status !== "LIVE") {
          throw new NotFoundError("Website", subdomain);
        }

        const deploymentId = website.productionDeploymentId;
        if (!deploymentId) {
          throw new NotFoundError("Website", subdomain);
        }

        const storagePath = `websites/${website.id}/deployments/${deploymentId}`;
        const objectKey = requestedPath
          ? `${storagePath}/${requestedPath}`
          : `${storagePath}/index.html`;

        let content: Buffer;
        try {
          content = await storage.get(objectKey);
        } catch (err) {
          // Fall back to index.html for directory-style requests (SPA fallback).
          if (!requestedPath || requestedPath.endsWith("/")) {
            try {
              content = await storage.get(`${storagePath}/index.html`);
            } catch {
              throw new NotFoundError("Not found", "NOT_FOUND");
            }
          } else {
            const msg = (err as Error).message;
            if (msg.includes("404") || msg.includes("no existe") || msg.includes("File not found")) {
              throw new NotFoundError("Not found", "NOT_FOUND");
            }
            throw err;
          }
        }

        res.setHeader("Content-Type", contentTypeFor(objectKey));
        res.setHeader("Cache-Control", cachePolicyFor(objectKey));
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("X-Frame-Options", "DENY");
        res.send(content);
      } catch (err) {
        next(err);
      }
    }
  );

  // Root path for a subdomain — serve index.html directly.
  router.get<{ subdomain: string }>("/:subdomain/", async (req, res, next) => {
    try {
      const subdomain = req.params.subdomain;
      if (isUnsafePath(subdomain)) {
        throw new NotFoundError("Not found", "NOT_FOUND");
      }

      let website;
      try {
        website = await websites.findBySubdomain(subdomain);
      } catch (dbErr) {
        res.status(503).json({ code: "DATABASE_UNAVAILABLE", message: "Database unavailable", details: null });
        return;
      }

      if (!website || website.status !== "LIVE" || !website.productionDeploymentId) {
        throw new NotFoundError("Website", req.params.subdomain);
      }

      const objectKey = `websites/${website.id}/deployments/${website.productionDeploymentId}/index.html`;
      const content = await storage.get(objectKey);

      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", cachePolicyFor(objectKey));
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("X-Frame-Options", "DENY");
      res.send(content);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
