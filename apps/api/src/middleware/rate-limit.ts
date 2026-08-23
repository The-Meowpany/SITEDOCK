import rateLimit from "express-rate-limit";

// Tighter limits on sensitive endpoints (login, password reset) per SECURITY.md §37.
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { code: "RATE_LIMITED", message: "Too many attempts, please try again later" },
});

export const apiRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
});

// Public, unauthenticated surface (demo checkout) — tighter than the general
// API since there is no session to attribute abuse to.
export const publicDemoRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { code: "RATE_LIMITED", message: "Too many attempts, please try again later" },
});
