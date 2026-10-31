import type { NextFunction, Request, Response } from "express";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Rejects state-changing browser requests that originate from an untrusted
 * site (CSRF). Only requests that carry an Origin header are checked.
 */
export function requireTrustedOrigin(allowedOrigins: readonly string[]) {
  const allowed = new Set(allowedOrigins.map((o) => o.replace(/\/$/, "").toLowerCase()));
  return (req: Request, res: Response, next: NextFunction): void => {
    const origin = req.headers.origin;
    if (SAFE_METHODS.has(req.method) || typeof origin !== "string") {
      next();
      return;
    }
    if (allowed.has(origin.replace(/\/$/, "").toLowerCase())) {
      next();
      return;
    }
    res.status(403).json({ code: "FORBIDDEN", message: "Untrusted request origin" });
  };
}
