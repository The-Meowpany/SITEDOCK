import { Router } from "express";
import { z } from "zod";
import { UserId } from "@sitedock/shared";
import {
  Argon2PasswordHasher,
  ConfirmPasswordResetUseCase,
  LoginUserUseCase,
  LogoutUserUseCase,
  PrismaPasswordResetRepository,
  PrismaSessionRepository,
  PrismaUserRepository,
  RegisterUserUseCase,
  RequestPasswordResetUseCase,
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
const confirmPasswordReset = new ConfirmPasswordResetUseCase(users, resets, hasher);

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


