import { Router } from "express";
import { prisma } from "@sitedock/database";
import {
  EnqueuePreviewDeploymentUseCase,
  EnqueueServiceDeploymentUseCase,
  PrismaPreviewRepository,
  PrismaServiceDeploymentRepository,
  PrismaServiceRepository,
} from "@sitedock/deployment";
import { findRepositoryConnection, verifyWebhookSignature } from "./github-auth.service";

const GITHUB_APP_WEBHOOK_SECRET = process.env.GITHUB_APP_WEBHOOK_SECRET || "";

const previewRepository = new PrismaPreviewRepository();
const enqueuePreviewDeployment = new EnqueuePreviewDeploymentUseCase(previewRepository);
const enqueueServiceDeployment = new EnqueueServiceDeploymentUseCase(
  new PrismaServiceRepository(),
  new PrismaServiceDeploymentRepository()
);

export const githubRouter = Router();

/**
 * Signed push webhook -> durable preview revision.
 *
 * The signature is verified over the raw payload before any side effect. The
 * repository connection is resolved from authoritative database state, never
 * from client-supplied website ids, so a webhook cannot enqueue a preview for
 * another tenant's website.
 */
githubRouter.post("/webhook", async (req, res, next) => {
  try {
    const signatureHeader = req.headers["x-hub-signature-256"];
    const signature = typeof signatureHeader === "string" ? signatureHeader : "";
    const event = typeof req.headers["x-github-event"] === "string" ? req.headers["x-github-event"] : "";

    // The app mounts this path with express.raw() BEFORE express.json(), so
    // the HMAC is computed over the exact bytes GitHub signed. A JSON-parsed
    // body would never match the signature.
    const raw = Buffer.isBuffer(req.body)
      ? req.body
      : typeof req.body === "string"
        ? Buffer.from(req.body, "utf8")
        : null;
    if (!raw || raw.length === 0) {
      res.status(400).json({ code: "MISSING_RAW_BODY", message: "Raw webhook body is required" });
      return;
    }

    if (!GITHUB_APP_WEBHOOK_SECRET) {
      res.status(503).json({
        code: "GITHUB_WEBHOOK_NOT_CONFIGURED",
        message: "GITHUB_APP_WEBHOOK_SECRET is not configured",
      });
      return;
    }

    if (!verifyWebhookSignature(GITHUB_APP_WEBHOOK_SECRET, raw, signature)) {
      res.status(401).json({ valid: false, code: "INVALID_SIGNATURE", message: "Invalid webhook signature" });
      return;
    }

    let payload: {
      installation?: { id?: number | string };
      repository?: { id?: number | string; full_name?: string; default_branch?: string };
      ref?: string;
      after?: string;
      deleted?: boolean;
      action?: string;
      pull_request?: {
        head?: { ref?: string; sha?: string };
        base?: { ref?: string };
        merged?: boolean;
      };
    };
    try {
      payload = JSON.parse(raw.toString("utf8"));
    } catch {
      res.status(400).json({ code: "INVALID_JSON", message: "Webhook body is not valid JSON" });
      return;
    }

    const installationId = payload.installation?.id?.toString();
    const repositoryId = payload.repository?.id?.toString();
    if (!installationId || !repositoryId) {
      res.status(400).json({ code: "MISSING_REPOSITORY", message: "Webhook is missing installation/repository" });
      return;
    }

    const connection = await findRepositoryConnection(installationId, repositoryId, prisma);
    if (!connection) {
      res.status(404).json({
        valid: false,
        code: "CONNECTION_NOT_FOUND",
        message: "Repository connection not found or not authorized",
      });
      return;
    }

    let branch: string | null = null;
    let commitSha: string | null = null;

    if (event === "push") {
      if (payload.deleted) {
        res.status(200).json({ valid: true, ignored: "branch-deleted" });
        return;
      }
      branch = (payload.ref ?? "").replace(/^refs\/heads\//, "").trim() || null;
      commitSha = payload.after ?? null;
      if (!branch || !commitSha || /^0+$/.test(commitSha)) {
        res.status(200).json({ valid: true, ignored: "no-commit" });
        return;
      }
    } else if (event === "pull_request") {
      if (!["opened", "synchronize", "reopened"].includes(payload.action ?? "")) {
        res.status(200).json({ valid: true, ignored: `pull_request.${payload.action ?? "unknown"}` });
        return;
      }
      branch = payload.pull_request?.head?.ref ?? null;
      commitSha = payload.pull_request?.head?.sha ?? null;
    } else {
      res.status(200).json({ valid: true, ignored: `event.${event || "unknown"}` });
      return;
    }

    if (!branch || !commitSha) {
      res.status(400).json({ code: "MISSING_COMMIT", message: "Webhook is missing branch/commit" });
      return;
    }

    // Default-branch pushes deploy the connected service when one exists;
    // everything else (and projects without a service) gets a preview.
    if (event === "push" && branch === connection.defaultBranch && connection.serviceId) {
      const result = await enqueueServiceDeployment.execute({
        serviceId: connection.serviceId,
        idempotencyKey: `github:${connection.repositoryId}:${commitSha.toLowerCase()}`,
      });
      res.status(202).json({ valid: true, mode: "service", ...result });
      return;
    }

    const result = await enqueuePreviewDeployment.execute({
      websiteId: connection.websiteId,
      branch,
      commitSha,
    });

    res.status(202).json({
      valid: true,
      mode: "preview",
      previewId: result.previewId,
      revisionId: result.revisionId,
      hostname: result.hostname,
      status: result.status,
    });
  } catch (err) {
    next(err);
  }
});

// Keep the established package entry-point contract.
export {
  exchangeCodeForToken,
  fetchRepositories,
  fetchRepositoryContents,
  generateJwt,
  initiateInstall,
  parseInstallationToken,
  verifyWebhookSignature,
} from "./github-auth.service";

export default githubRouter;
