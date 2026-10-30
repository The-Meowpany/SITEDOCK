import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import pathMod from "node:path";
import crypto from "node:crypto";
import { ContainerService } from "../infrastructure/container-service";
import {
  ContainerInstanceRepository,
  DeploymentLogRepository,
  ServiceDeploymentRepository,
  ServiceRepository,
} from "../domain/ports";
import { ContainerInstance } from "../domain/container-instance.entity";
import { DomainError, InfrastructureError, SecretCipher } from "@sitedock/shared";

const LEASE_MS = 300_000;

export async function pollHealth(
  containerService: ContainerService,
  containerId: string,
  path: string = "/health",
  maxAttempts: number = 20,
  intervalMs: number = 300
): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    const result = await containerService.checkHealth(containerId, path, 1500);
    if (result.healthy) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

export function stringifyEnv(env: Record<string, unknown> | null): Record<string, string> {
  if (!env) return {};
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === null || value === undefined) continue;
    result[key] = typeof value === "string" ? value : JSON.stringify(value);
  }
  return result;
}

export function decryptSecrets(
  secrets: Record<string, unknown> | null,
  cipher: SecretCipher | null
): Record<string, string> {
  if (!secrets || Object.keys(secrets).length === 0) return {};
  if (!cipher) {
    throw new DomainError(
      "Service has encrypted secrets but SITEDOCK_SECRETS_KEY is not configured",
      "SECRETS_KEY_NOT_CONFIGURED"
    );
  }

  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(secrets)) {
    if (!SecretCipher.isEncrypted(value)) {
      throw new DomainError(`Secret '${key}' is not encrypted`, "INVALID_SECRET_PAYLOAD");
    }
    result[key] = cipher.decrypt(value);
  }
  return result;
}

export function decodeContextFiles(files: Record<string, string> | null): Record<string, Buffer> {
  if (!files) return {};
  const decoded: Record<string, Buffer> = {};
  let total = 0;
  for (const [path, encoded] of Object.entries(files)) {
    if (!/^[A-Za-z0-9._/-]{1,200}$/.test(path) || path.includes("..") || path.startsWith("/")) {
      throw new DomainError(`Invalid build context path '${path}'`, "INVALID_CONTEXT_FILE");
    }
    if (typeof encoded !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
      throw new DomainError(`Build context file '${path}' is not valid base64`, "INVALID_CONTEXT_FILE");
    }
    const content = Buffer.from(encoded, "base64");
    total += content.length;
    if (total > 6 * 1024 * 1024) {
      throw new DomainError("Build context exceeds 6 MiB", "CONTEXT_TOO_LARGE");
    }
    decoded[path] = content;
  }
  return decoded;
}

// `GIT_SSH_COMMAND` and `--config` are the only interpolation points. Every
// other argument arrives from the customer's repository configuration and is
// passed through without modification, so it can only ever be an option to
// `git` or a path relative to `cwd` (CWE-78).
export async function runGit(args: string[], cwd: string){
  const safe = args.map((a) => {
    // Enforce a strict white-list: only a leading option (single dash) or a
    // relative path. Unknown option spelling and absolute/full paths are
    // rejected instead of being guessed at, so a customer-controlled value
    // can never become a new argument.
    if (/^-[^-]/.test(a) || /^\.\.?[/\\]|^[^/\\]/.test(a)) {
      return a;
    }
    throw new DomainError(`Unsafe git argument: "${a}"`, "UNSAFE_GIT_ARGUMENT");
  });
  return new Promise((resolve,reject)=>{
    const proc = spawn("git", safe, {cwd, env:{...process.env, GIT_TERMINAL_PROMPT:"0"}, stdio:["ignore","pipe","pipe"]});
    let stdout="", stderr="";
    proc.stdout.on("data",d=>{stdout+=d.toString();});
    proc.stderr.on("data",d=>{stderr+=d.toString();});
    const t=setTimeout(()=>{try{proc.kill("SIGKILL");}catch{}reject(new DomainError("Git operation timed out","GIT_TIMEOUT"));},120000);
    proc.on("close",code=>{clearTimeout(t); if(code===0)resolve(stdout); else reject(new DomainError("Git failed: "+stderr.slice(0,200),"GIT_FAILED"));});
  });
}

export async function materializeGitSource(service: { sourceUrl: string | null; sourcePath?: string | null; dockerfile?: string | null }, commitSha: string | undefined): Promise<{ dockerfile: string; contextFiles: Record<string, Buffer> }> {
  const sourceUrl = service.sourceUrl;
  if(!sourceUrl) throw new DomainError("Missing sourceUrl for git deployment","MISSING_SOURCE_URL");
  if(!commitSha) throw new DomainError("Missing commit SHA for git deployment","MISSING_COMMIT_SHA");
  const tmpDir = fs.mkdtempSync(pathMod.join(os.tmpdir(),"sitedock-git-"));
  try{
    await runGit(["init"], tmpDir);
    await runGit(["remote","add","origin",sourceUrl], tmpDir);
    await runGit(["fetch","--depth","1","origin",commitSha], tmpDir);
    await runGit(["checkout","FETCH_HEAD"], tmpDir);
    let dockerfile=null;
    const candidates=[
      pathMod.join(tmpDir, service.dockerfile||"Dockerfile"),
      pathMod.join(tmpDir, service.sourcePath||"", service.dockerfile||"Dockerfile"),
      pathMod.join(tmpDir,"Dockerfile"),
    ];
    for(const cnd of candidates){ if(cnd && fs.existsSync(cnd)){ dockerfile=fs.readFileSync(cnd,"utf8"); break; }}
    if(!dockerfile) throw new DomainError("Dockerfile not found in repository","MISSING_DOCKERFILE");
    const contextFiles: Record<string, Buffer> = {};
    const walk = (dir: string, base: string = ""): void => {
      const entries=fs.readdirSync(dir);
      for(const entry of entries){
        if(entry===".git") continue;
        const full=pathMod.join(dir,entry);
        const rel=base?pathMod.join(base,entry):entry;
        const stat=fs.statSync(full);
        if(stat.isDirectory()){ walk(full,rel); }
        else if(stat.isFile()){ const content=fs.readFileSync(full); contextFiles[rel.replace(/\\/g,"/")]=content; }
      }
    };
    walk(tmpDir);
    return {dockerfile, contextFiles};
  }finally{
    try{fs.rmSync(tmpDir,{recursive:true,force:true});}catch{}
  }
}

export function validateDockerfile(serviceSourceType: string, dockerfile: string | null | undefined): string {
  if (!dockerfile || !dockerfile.trim()) {
    if (serviceSourceType === "github" || serviceSourceType === "git" || serviceSourceType === "local-git") {
      throw new DomainError(
        "Git source repositories are not materialized yet; create the service with sourceType 'dockerfile' and inline Dockerfile content",
        "SOURCE_NOT_MATERIALIZED"
      );
    }
    throw new DomainError("Missing Dockerfile content for service deployment", "MISSING_DOCKERFILE");
  }
  if (dockerfile.length > 64 * 1024) {
    throw new DomainError("Dockerfile exceeds the 64 KiB limit", "DOCKERFILE_TOO_LARGE");
  }
  // Line-oriented validation: check that the first non-comment, non-whitespace
  // line starts with FROM (optionally followed by a platform prefix).
  const firstInstruction = dockerfile
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith("#"));
  if (!firstInstruction) {
    throw new DomainError("Dockerfile must contain a FROM instruction", "INVALID_DOCKERFILE");
  }
  // Match valid FROM instructions: FROM <image> or FROM <platform>/<image>:<tag>
  // Also support FROM --platform=<platform> <image>:<tag> (Docker Buildx)
  const fromRegex = /^FROM\s+(\S+)/i;
  if (!fromRegex.test(firstInstruction)) {
    throw new DomainError("Dockerfile must contain a valid FROM instruction", "INVALID_DOCKERFILE");
  }
  return dockerfile;
}

export class BuildAndDeployServiceUseCase {
  constructor(
    private readonly serviceRepository: ServiceRepository,
    private readonly deploymentRepository: ServiceDeploymentRepository,
    private readonly containerInstanceRepository: ContainerInstanceRepository,
    private readonly logRepository: DeploymentLogRepository,
    private readonly containerService: ContainerService,
    private readonly secretCipher: SecretCipher | null = null
  ) {}

  async execute(params: {
    serviceId: string;
    deploymentId: string;
    dockerfileContent?: string;
    contextFiles?: Record<string, Buffer>;
    sourceCommitSha?: string;
    workerId: string;
    leaseGeneration: number;
  }): Promise<{ deploymentId: string; version: number; containerId: string; containerPort: number; hostPort: number }> {
    const service = await this.serviceRepository.findById(params.serviceId);
    if (!service) {
      throw new DomainError(`Service ${params.serviceId} not found`, "SERVICE_NOT_FOUND");
    }

    const deployment = await this.deploymentRepository.findById(params.deploymentId);
    if (!deployment) {
      throw new DomainError(`Deployment ${params.deploymentId} not found`, "DEPLOYMENT_NOT_FOUND");
    }
    if (deployment.serviceId !== service.id) {
      throw new DomainError(
        `Deployment ${deployment.id} does not belong to service ${service.id}`,
        "DEPLOYMENT_SERVICE_MISMATCH"
      );
    }
    if (deployment.status !== "BUILDING") {
      throw new DomainError(
        `Deployment ${deployment.id} is ${deployment.status}; worker execution requires a claimed BUILDING deployment`,
        "DEPLOYMENT_NOT_CLAIMED"
      );
    }

    const { workerId, leaseGeneration } = params;
    const assertLease = async () => {
      const owned = await this.deploymentRepository.renewLease(deployment.id, workerId, leaseGeneration, LEASE_MS);
      if (!owned) {
        throw new DomainError(
          `Stale lease: deployment ${deployment.id} is no longer owned by ${workerId}/${leaseGeneration}`,
          "STALE_LEASE"
        );
      }
    };
    await assertLease();

    const wasAlreadyLive = service.status === "LIVE" && Boolean(service.activeDeploymentId);

    let newlyCreatedContainerId: string | null = null;
    let newInstanceId: string | null = null;
    let activated = false;

    try {
      let dockerfile: string;
      let contextFiles: Record<string, Buffer>;
      if (service.sourceType === "git" || service.sourceType === "github" || service.sourceType === "local-git") {
        const materialized = await materializeGitSource(service, params.sourceCommitSha);
        dockerfile = validateDockerfile(service.sourceType, materialized.dockerfile);
        contextFiles = materialized.contextFiles;
      } else {
        dockerfile = validateDockerfile(service.sourceType, params.dockerfileContent ?? service.dockerfile);
        contextFiles = params.contextFiles ?? decodeContextFiles(service.contextFiles);
      }

      // 1. Mark service BUILDING (fenced by a fresh lease).
      await assertLease();
      if (service.status !== "BUILDING") {
        try { service.startBuilding(); } catch { /* already in a compatible state */ }
        await this.serviceRepository.save(service);
      }
      await this.logRepository.create(deployment.id, "info", "Build started", { version: deployment.version });

      // 2. Build the immutable image.
      const imageTag = `sitedock-service-${service.id}-v${deployment.version}`;
      const artifact = await this.containerService.buildFromDockerfile(
        dockerfile,
        contextFiles,
        imageTag
      );

      deployment.markBuilt(artifact.imageId, artifact.digest, artifact.buildLog);
      await this.deploymentRepository.saveWithLease(deployment, workerId, leaseGeneration);
      await this.logRepository.create(deployment.id, "info", "Build completed", {
        imageId: artifact.imageId,
        imageDigest: artifact.digest,
      });

      // 3. Start the new container in the runtime namespace.
      await assertLease();
      if (service.status !== "DEPLOYING") {
        try { service.startDeploying(); } catch { /* already deploying */ }
        await this.serviceRepository.save(service);
      }

      const containerPort = service.port ?? 8080;
      const containerName = `sitedock-${service.id}-v${deployment.version}`;
      const running = await this.containerService.runContainer(artifact.imageId, {
        name: containerName,
        env: {
          ...stringifyEnv(service.env),
          ...decryptSecrets(service.secrets ?? null, this.secretCipher),
        },
        ports: { [String(containerPort)]: "0" },
        memoryLimit: service.memoryLimit || undefined,
        cpuLimit: service.cpuLimit || undefined,
        pidsLimit: service.pidsLimit ?? undefined,
        readonlyRoot: service.readonlyRoot,
        labels: {
          "sitedock.deployment.id": deployment.id,
          "sitedock.service.id": service.id,
          "sitedock.version": String(deployment.version),
        },
      });
      newlyCreatedContainerId = running.id;

      await this.logRepository.create(deployment.id, "info", "Container runtime started", {
        containerId: running.id,
        hostPort: running.hostPort,
      });

      // 4. Verify health inside the runtime network namespace.
      const isHealthy = await pollHealth(this.containerService, running.id, "/health");
      if (!isHealthy) {
        throw new InfrastructureError(
          `Health verification failed for deployment ${deployment.id} in container ${running.id}`,
          "HEALTH_CHECK_FAILED"
        );
      }
      await this.logRepository.create(deployment.id, "info", "Health verification succeeded", {
        hostPort: running.hostPort,
      });

      // 5. Persist the new runtime instance. Routing still points at the old
      // active deployment until the fenced activation transaction below.
      const instance = ContainerInstance.create({
        id: crypto.randomUUID(),
        serviceId: service.id,
        deploymentId: deployment.id,
        containerId: running.id,
        hostPort: running.hostPort,
        containerPort,
      });
      newInstanceId = instance.id;
      await this.containerInstanceRepository.save(instance);

      // 6. Atomically activate: deployment READY + service LIVE + active id,
      // conditional on worker ownership and lease generation.
      await assertLease();
      service.activate(deployment.id);
      await this.deploymentRepository.activateWithLease(deployment, service, workerId, leaseGeneration);
      activated = true;

      // 7. Only after activation, retire previous runtime instances.
      const existingDeployments = await this.deploymentRepository.listByService(service.id);
      for (const dep of existingDeployments) {
        if (dep.id === deployment.id) continue;
        const prevInstances = await this.containerInstanceRepository.listByDeployment(dep.id);
        for (const prev of prevInstances) {
          if (prev.status === "RUNNING") {
            try {
              prev.markStopped();
              await this.containerInstanceRepository.save(prev);
              await this.containerService.stopContainer(prev.containerId);
            } catch {
              // Best-effort cleanup; the active deployment is already correct.
            }
          }
        }
      }

      await this.logRepository.create(deployment.id, "info", "Deployment live and routable", {
        containerId: running.id,
        hostPort: running.hostPort,
        hostname: service.hostname,
      });

      return {
        deploymentId: deployment.id,
        version: deployment.version,
        containerId: running.id,
        containerPort,
        hostPort: running.hostPort,
      };
    } catch (err) {
      // Never let a stale worker delete or mutate resources owned by a newer
      // worker. `activated` is only true after the fenced transaction passed.
      if (!activated) {
        if (newlyCreatedContainerId) {
          try {
            await this.containerService.stopContainer(newlyCreatedContainerId);
          } catch {
            // Reconciliation will remove any orphan by deployment label.
          }
        }
        if (newInstanceId) {
          try {
            await this.containerInstanceRepository.delete(newInstanceId);
          } catch {
            // The instance was never used for routing; safe to ignore.
          }
        }
      }

      const errMsg = (err as Error).message;
      const isStale =
        err instanceof DomainError && (err.code === "STALE_LEASE" || err.code === "LEASE_EXPIRED");

      if (isStale || activated) {
        // A newer worker owns the deployment; do not touch deployment/service.
        throw err;
      }

      if (deployment.hasRetriesRemaining()) {
        deployment.scheduleRetry(5000 * Math.pow(2, Math.max(0, deployment.attempts - 1)));
      } else {
        deployment.markFailed(errMsg);
      }

      try {
        await this.deploymentRepository.saveWithLease(deployment, workerId, leaseGeneration);
      } catch (persistErr) {
        // Lost the race while handling failure: do not write anything else.
        if (persistErr instanceof DomainError && persistErr.code === "STALE_LEASE") throw persistErr;
        throw persistErr;
      }

      // Record the real failure before touching lifecycle state: a state
      // transition error here must never replace the reason the deployment
      // failed (that was how PENDING services hid their first-build errors).
      try {
        await this.logRepository.create(deployment.id, "error", errMsg);
      } catch {
        // Logging is diagnostic; the deployment status below is authoritative.
      }

      if (wasAlreadyLive) {
        // Keep serving the previously healthy release.
        try {
          service.restorePreviousLive();
        } catch {
          // The active deployment pointer is unchanged, so the old release stays routable.
        }
      } else if (service.status !== "FAILED") {
        try {
          service.markFailed(errMsg);
        } catch {
          // Preserve the original error even if the entity refuses the transition.
        }
      }
      try {
        await this.serviceRepository.save(service);
      } catch {
        // Same reason: the deployment row already carries the failure.
      }
      throw err;
    }
  }
}

