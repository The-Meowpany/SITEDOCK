import { NextFunction, Request, Response, Router } from "express";
import { z } from "zod";
import { UserId } from "@sitedock/shared";
import {
  Argon2PasswordHasher,
  ChangeEmailUseCase,
  ChangePasswordUseCase,
  ConfirmPasswordResetUseCase,
  DeleteAccountUseCase,
  LoginUserUseCase,
  LogoutUserUseCase,
  ManageSessionsUseCase,
  PrismaAccountDeletionRepository,
  PrismaPasswordResetRepository,
  PrismaSessionAdminRepository,
  PrismaSessionRepository,
  PrismaUserRepository,
  RegisterUserUseCase,
  RequestPasswordResetUseCase,
  UpdateProfileUseCase,
  hashToken,
} from "@sitedock/auth";
import { config } from "../config";
import { authRateLimiter } from "../middleware/rate-limit";
import { requireSession } from "../middleware/require-session";
import { notifyBestEffort } from "../notifications";
import { auditBestEffort } from "../audit";

const users = new PrismaUserRepository();
const hasher = new Argon2PasswordHasher();
const sessions = new PrismaSessionRepository();
const resets = new PrismaPasswordResetRepository();

const registerUser = new RegisterUserUseCase(users, hasher);
const loginUser = new LoginUserUseCase(users, hasher, sessions);
const logoutUser = new LogoutUserUseCase(sessions);
const requestPasswordReset = new RequestPasswordResetUseCase(users, resets);
const sessionAdmin = new PrismaSessionAdminRepository();
const confirmPasswordReset = new ConfirmPasswordResetUseCase(users, resets, hasher, sessionAdmin);
const changePassword = new ChangePasswordUseCase(users, hasher, sessionAdmin);
const updateProfile = new UpdateProfileUseCase(users);
const changeEmail = new ChangeEmailUseCase(users, hasher, sessionAdmin);
const manageSessions = new ManageSessionsUseCase(sessionAdmin);
const deleteAccount = new DeleteAccountUseCase(users, hasher, new PrismaAccountDeletionRepository());

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  fullName: z.string().min(2),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const cookieOptions = {
  httpOnly: true,
  secure: config.isProduction,
  sameSite: "lax" as const,
  domain: config.cookieDomain,
};

export const authRouter = Router();

/**
 * Account self-service is for a human with a browser session. API tokens (CI, scripts)
 * must never change a password, swap the email or delete the account.
 */
function requireInteractiveSession(req: Request, res: Response, next: NextFunction) {
  if (req.apiToken) {
    res.status(403).json({ code: "FORBIDDEN", message: "API tokens cannot manage the account" });
    return;
  }
  requireSession(req, res, next);
}

authRouter.post("/register", authRateLimiter, async (req, res, next) => {
  try {
    const body = registerSchema.parse(req.body);
    const result = await registerUser.execute(body);
    notifyBestEffort({ type: "welcome", recipientEmail: result.email, fullName: result.fullName });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

authRouter.post("/login", authRateLimiter, async (req, res, next) => {
  try {
    const body = loginSchema.parse(req.body);
    const result = await loginUser.execute({
      ...body,
      userAgent: req.headers["user-agent"],
      ipAddress: req.ip,
    });
    auditBestEffort({ actorId: result.userId, action: "USER_LOGIN", resourceType: "User", resourceId: result.userId });
    res.cookie("sid", result.sessionToken, { ...cookieOptions, expires: result.expiresAt });
    res.json({ userId: result.userId, fullName: result.fullName });
  } catch (err) {
    next(err);
  }
});

authRouter.post("/logout", requireSession, async (req, res, next) => {
  try {
    const token = req.cookies?.sid;
    if (token) await logoutUser.execute(token);
    res.clearCookie("sid", cookieOptions);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

authRouter.post("/password-reset/request", authRateLimiter, async (req, res, next) => {
  try {
    const { email } = z.object({ email: z.string().email() }).parse(req.body);
    const result = await requestPasswordReset.execute(email);
    if (result) {
      notifyBestEffort({
        type: "password_reset",
        recipientEmail: email,
        resetUrl: `${config.dashboardUrl}/reset-password/${result.rawToken}`,
      });
    }
    res.status(202).json({ message: "If that email exists, a reset link has been sent." });
  } catch (err) {
    next(err);
  }
});

authRouter.post("/password-reset/confirm", authRateLimiter, async (req, res, next) => {
  try {
    const { token, newPassword } = z
      .object({ token: z.string().min(10), newPassword: z.string().min(8) })
      .parse(req.body);
    await confirmPasswordReset.execute(token, newPassword);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

authRouter.get("/me", requireSession, async (req, res, next) => {
  try {
    const user = await users.findById(UserId(req.userId!));
    if (!user) return res.status(404).json({ code: "NOT_FOUND", message: "User not found" });
    res.json({ id: user.id, email: user.email.value, fullName: user.fullName, platformRole: user.platformRole });
  } catch (err) {
    next(err);
  }
});

const updateProfileSchema = z.object({ fullName: z.string().min(2).max(120) });
const changePasswordSchema = z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(8).max(256) });
const changeEmailSchema = z.object({ newEmail: z.string().email().max(254), currentPassword: z.string().min(1) });
const deleteAccountSchema = z.object({ currentPassword: z.string().min(1) });

function currentSessionHash(req: Request): string | undefined {
  const token = req.cookies?.sid;
  return typeof token === "string" ? hashToken(token) : undefined;
}

authRouter.patch("/me", requireInteractiveSession, async (req, res, next) => {
  try {
    const { fullName } = updateProfileSchema.parse(req.body);
    const result = await updateProfile.execute({ userId: UserId(req.userId!), fullName });
    auditBestEffort({ actorId: req.userId, action: "USER_PROFILE_UPDATED", resourceType: "User", resourceId: req.userId });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

authRouter.post("/me/password", authRateLimiter, requireInteractiveSession, async (req, res, next) => {
  try {
    const body = changePasswordSchema.parse(req.body);
    const userId = UserId(req.userId!);
    const { revokedSessions } = await changePassword.execute({
      userId,
      ...body,
      currentSessionTokenHash: currentSessionHash(req),
    });
    const user = await users.findById(userId);
    if (user) notifyBestEffort({ type: "security_notice", recipientEmail: user.email.value, change: "password_changed" });
    auditBestEffort({ actorId: req.userId, action: "USER_PASSWORD_CHANGED", resourceType: "User", resourceId: req.userId, metadata: { revokedSessions } });
    res.json({ revokedSessions });
  } catch (err) {
    next(err);
  }
});

authRouter.post("/me/email", authRateLimiter, requireInteractiveSession, async (req, res, next) => {
  try {
    const body = changeEmailSchema.parse(req.body);
    const result = await changeEmail.execute({
      userId: UserId(req.userId!),
      ...body,
      currentSessionTokenHash: currentSessionHash(req),
    });
    // Tell the OLD address: if the account was hijacked, that is the only inbox the owner still controls.
    notifyBestEffort({ type: "security_notice", recipientEmail: result.oldEmail, change: "email_changed" });
    auditBestEffort({ actorId: req.userId, action: "USER_EMAIL_CHANGED", resourceType: "User", resourceId: req.userId });
    res.json({ email: result.newEmail });
  } catch (err) {
    next(err);
  }
});

authRouter.get("/me/sessions", requireInteractiveSession, async (req, res, next) => {
  try {
    const current = currentSessionHash(req);
    const list = await manageSessions.list(UserId(req.userId!));
    res.json(
      list.map((s) => ({
        id: s.id,
        userAgent: s.userAgent,
        ipAddress: s.ipAddress,
        createdAt: s.createdAt,
        expiresAt: s.expiresAt,
        current: s.tokenHash === current,
      }))
    );
  } catch (err) {
    next(err);
  }
});

authRouter.post("/me/sessions/revoke-others", requireInteractiveSession, async (req, res, next) => {
  try {
    const current = currentSessionHash(req);
    if (!current) {
      res.status(401).json({ code: "UNAUTHORIZED", message: "Not authenticated" });
      return;
    }
    const revoked = await manageSessions.revokeOthers(UserId(req.userId!), current);
    auditBestEffort({ actorId: req.userId, action: "USER_SESSION_REVOKED", resourceType: "User", resourceId: req.userId, metadata: { revoked } });
    res.json({ revoked });
  } catch (err) {
    next(err);
  }
});

authRouter.delete("/me/sessions/:sessionId", requireInteractiveSession, async (req, res, next) => {
  try {
    const sessionId = z.string().uuid().parse(req.params.sessionId);
    await manageSessions.revokeOne(UserId(req.userId!), sessionId);
    auditBestEffort({ actorId: req.userId, action: "USER_SESSION_REVOKED", resourceType: "Session", resourceId: sessionId });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

authRouter.delete("/me", authRateLimiter, requireInteractiveSession, async (req, res, next) => {
  try {
    const { currentPassword } = deleteAccountSchema.parse(req.body);
    const deleted = await deleteAccount.execute({ userId: UserId(req.userId!), currentPassword });
    notifyBestEffort({ type: "security_notice", recipientEmail: deleted.email, change: "account_deleted" });
    auditBestEffort({ actorId: null, action: "USER_ACCOUNT_DELETED", resourceType: "User", resourceId: req.userId });
    res.clearCookie("sid", cookieOptions);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
