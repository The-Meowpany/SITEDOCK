#!/usr/bin/env node
/**
 * SiteDock trusted runtime agent.
 *
 * This process is the ONLY component allowed to talk to the container runtime.
 * It runs in the Linux/Podman host as a dedicated non-root user (rootless
 * Podman) and exposes a deliberately narrow, authenticated HTTP API to the
 * trusted SiteDock worker/API on localhost:
 *
 *   POST   /v1/images/build          build an image from an isolated context
 *   POST   /v1/containers            create + start a tenant container
 *   GET    /v1/containers/:id        inspect a container
 *   GET    /v1/containers/:id/logs   read bounded container logs
 *   GET    /v1/containers/:id/health probe the container's /health endpoint
 *   POST   /v1/containers/:id/stop   stop a container
 *   DELETE /v1/containers/:id        remove a container
 *   GET    /v1/containers            list managed containers by label
 *
 * Tenant containers never receive the Podman socket, this agent's token, or a
 * route to arbitrary commands. The agent never executes shell strings: every
 * Podman invocation uses an argv array. Only images built by this agent
 * (sha256 ids) can be run; arbitrary registry references are rejected.
 */
import http from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { buildPullArgsForVersion, isUnsupportedBuildNoNewPrivileges } from "./podman-compat.mjs";

const HOST = process.env.RUNTIME_AGENT_HOST ?? "127.0.0.1";
const PORT = Number(process.env.RUNTIME_AGENT_PORT ?? 4010);
const TOKEN = process.env.RUNTIME_AGENT_TOKEN ?? "";
const PODMAN = process.env.PODMAN_BIN ?? "podman";
const MAX_BODY_BYTES = 8 * 1024 * 1024;
const BUILD_TIMEOUT_MS = 300_000;
const DEFAULT_CONTAINER_MEMORY = "256m";
const DEFAULT_CONTAINER_CPUS = "0.5";
const DEFAULT_PIDS_LIMIT = 100;
const MAX_PIDS_LIMIT = 4096;

if (TOKEN.length < 32) {
  console.error("[runtime-agent] RUNTIME_AGENT_TOKEN must be set to at least 32 characters");
  process.exit(1);
}

const log = (event, fields = {}) => {
  console.log(JSON.stringify({ ts: new Date().toISOString(), component: "runtime-agent", event, ...fields }));
};

class AgentError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function runPodman(args, { timeoutMs = 60_000, maxOutput = 256 * 1024 } = {}) {
  return new Promise((resolvePromise, reject) => {
    // cgroupfs is required for every subcommand on rootless hosts without a
    // systemd user session (e.g. bare WSL2): the default systemd cgroup manager
    // fails with "sd-bus call: Permission denied" on build RUN steps and on
    // restart/stop of existing containers. It is a supported manager on
    // systemd hosts too, so applying it uniformly keeps behavior consistent.
    const child = spawn(PODMAN, ["--cgroup-manager=cgroupfs", ...args], {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR,
        TMPDIR: process.env.TMPDIR,
      },
    });

    let stdout = "";
    let stderr = "";
    let killed = false;
    const append = (current, chunk) => {
      const next = current + chunk.toString();
      return next.length > maxOutput ? next.slice(-maxOutput) : next;
    };

    child.stdout.on("data", (c) => (stdout = append(stdout, c)));
    child.stderr.on("data", (c) => (stderr = append(stderr, c)));

    const timer = setTimeout(() => {
      killed = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new AgentError(500, "RUNTIME_UNAVAILABLE", `Cannot execute ${PODMAN}: ${err.message}`));
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (killed) {
        reject(new AgentError(504, "RUNTIME_TIMEOUT", `Podman command exceeded ${timeoutMs}ms`));
        return;
      }
      resolvePromise({ code: code ?? 1, stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

async function podman(args, options) {
  const result = await runPodman(args, options);
  if (result.code !== 0) {
    throw new AgentError(
      500,
      "RUNTIME_COMMAND_FAILED",
      `podman ${args[0]} failed (${result.code}): ${(result.stderr || result.stdout).slice(-2000)}`
    );
  }
  return result;
}

// Podman 3.x (Ubuntu 22.04 / Debian 12) has no `build --pull=<policy>`.
let buildPullArgsPromise;
function buildPullArgs() {
  buildPullArgsPromise ??= runPodman(["--version"], { timeoutMs: 5000 }).then(
    (r) => buildPullArgsForVersion(r.code === 0 ? r.stdout : ""),
    () => []
  );
  return buildPullArgsPromise;
}

// Buildah behind most Podman releases rejects `build --security-opt
// no-new-privileges`; containers still always run with it (see createContainer).
let buildNoNewPrivileges = true;

async function inspectContainer(idOrName) {
  const result = await podman(["inspect", idOrName]);
  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    throw new AgentError(500, "RUNTIME_BAD_RESPONSE", "podman inspect returned invalid JSON");
  }
  const data = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!data) throw new AgentError(404, "CONTAINER_NOT_FOUND", `Container ${idOrName} not found`);
  return data;
}

// Health verification polls in a tight loop immediately after a container is
// created. Every `podman inspect` is a full process spawn (seconds on slow or
// rootless hosts), so a very short-lived summary cache keeps the readiness
// probe about the application instead of about the container runtime. Routing
// and status lookups still read fresh state.
const SUMMARY_CACHE_TTL_MS = Number(process.env.RUNTIME_AGENT_SUMMARY_CACHE_MS ?? 20_000);
const MAX_SUMMARY_CACHE_ENTRIES = 500;
const summaryCache = new Map();

function rememberSummary(summary) {
  const entry = { summary, at: Date.now() };
  summaryCache.set(summary.id, entry);
  if (summary.name) summaryCache.set(summary.name, entry);
  while (summaryCache.size > MAX_SUMMARY_CACHE_ENTRIES) {
    const oldest = summaryCache.keys().next().value;
    if (oldest === undefined) break;
    summaryCache.delete(oldest);
  }
}

function forgetSummary(idOrName) {
  summaryCache.delete(idOrName);
}

async function cachedContainerSummary(idOrName) {
  const hit = summaryCache.get(idOrName);
  if (hit && Date.now() - hit.at < SUMMARY_CACHE_TTL_MS) return hit.summary;
  const summary = containerSummary(await inspectContainer(idOrName));
  rememberSummary(summary);
  return summary;
}

function containerSummary(data) {
  const ports = data?.NetworkSettings?.Ports ?? {};
  let hostPort = null;
  for (const bindings of Object.values(ports)) {
    if (Array.isArray(bindings) && bindings[0]?.HostPort) {
      hostPort = Number(bindings[0].HostPort);
      break;
    }
  }
  return {
    id: data.Id,
    name: (data.Name ?? "").replace(/^\//, ""),
    running: Boolean(data?.State?.Running),
    status: data?.State?.Status ?? "unknown",
    exitCode: data?.State?.ExitCode ?? null,
    hostPort,
    labels: data?.Config?.Labels ?? {},
    startedAt: data?.State?.StartedAt ?? null,
    finishedAt: data?.State?.FinishedAt ?? null,
  };
}

function assertToken(req) {
  const header = req.headers.authorization ?? "";
  const expected = `Bearer ${TOKEN}`;
  if (header.length !== expected.length) {
    throw new AgentError(401, "UNAUTHORIZED", "Missing or invalid runtime agent token");
  }
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) mismatch |= header.charCodeAt(i) ^ expected.charCodeAt(i);
  if (mismatch !== 0) throw new AgentError(401, "UNAUTHORIZED", "Missing or invalid runtime agent token");
}

function assertName(value) {
  if (typeof value !== "string" || !/^sitedock-[a-z0-9-]{1,80}$/.test(value)) {
    throw new AgentError(400, "INVALID_NAME", "Container name must match sitedock-[a-z0-9-]");
  }
  return value;
}

function assertContainerId(value) {
  if (typeof value !== "string" || !/^[a-f0-9]{12,64}$/.test(value)) {
    throw new AgentError(400, "INVALID_CONTAINER_ID", "Container id must be a hexadecimal runtime id");
  }
  return value;
}

function assertImage(image) {
  if (typeof image !== "string" || !/^(sha256:)?[a-f0-9]{64}$/.test(image)) {
    throw new AgentError(400, "INVALID_IMAGE", "Only local images identified by sha256:<64 hex> can be run");
  }
  return image;
}

function assertImageTag(tag) {
  if (typeof tag !== "string" || !/^[a-z0-9][a-z0-9._-]{0,120}$/.test(tag)) {
    throw new AgentError(400, "INVALID_TAG", "Image tag must be a lowercase local tag");
  }
  return tag;
}

function assertPathWithin(base, relative) {
  if (typeof relative !== "string" || relative.length === 0 || relative.length > 200) {
    throw new AgentError(400, "INVALID_CONTEXT_FILE", "Context file path is invalid");
  }
  if (relative.includes("\0") || relative.startsWith("/") || relative.includes("..")) {
    throw new AgentError(400, "INVALID_CONTEXT_FILE", `Unsafe context file path: ${relative}`);
  }
  const full = resolve(base, relative);
  if (full !== base && !full.startsWith(base + sep)) {
    throw new AgentError(400, "INVALID_CONTEXT_FILE", `Context file escapes build directory: ${relative}`);
  }
  return full;
}

function assertMemory(value) {
  if (value === undefined) return DEFAULT_CONTAINER_MEMORY;
  if (typeof value !== "string" || !/^[1-9][0-9]{0,5}([bkmg])?$/i.test(value)) {
    throw new AgentError(400, "INVALID_MEMORY", "memoryLimit must look like 256m or 1g");
  }
  return value.toLowerCase();
}

function assertCpu(value) {
  if (value === undefined) return DEFAULT_CONTAINER_CPUS;
  if (typeof value !== "string" || !/^(0\.[1-9][0-9]?|[1-4](\.0)?)$/.test(value)) {
    throw new AgentError(400, "INVALID_CPU", "cpuLimit must be between 0.1 and 4");
  }
  return value;
}

function assertPids(value) {
  if (value === undefined) return DEFAULT_PIDS_LIMIT;
  if (!Number.isInteger(value) || value < 1 || value > MAX_PIDS_LIMIT) {
    throw new AgentError(400, "INVALID_PIDS", `pidsLimit must be 1..${MAX_PIDS_LIMIT}`);
  }
  return value;
}

function assertEnv(env) {
  if (env === undefined || env === null) return {};
  if (typeof env !== "object" || Array.isArray(env)) {
    throw new AgentError(400, "INVALID_ENV", "env must be an object");
  }
  const entries = Object.entries(env);
  if (entries.length > 64) throw new AgentError(400, "INVALID_ENV", "Too many environment variables");
  const clean = {};
  for (const [key, value] of entries) {
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(key)) {
      throw new AgentError(400, "INVALID_ENV", `Invalid environment variable name: ${key}`);
    }
    // Never hand control-plane credentials or runtime access to tenant code.
    // Preview metadata (`SITEDOCK_PREVIEW_*`) is intentionally injected by the
    // deployment use case and is not a credential, so it is allowed; database
    // URLs, the agent token and any other SITEDOCK_* variable remain reserved.
    const reserved =
      key === "DATABASE_URL" ||
      key === "RUNTIME_AGENT_TOKEN" ||
      (key.startsWith("SITEDOCK_") && !key.startsWith("SITEDOCK_PREVIEW_"));
    if (reserved) {
      throw new AgentError(400, "FORBIDDEN_ENV", `Environment variable ${key} is reserved by SiteDock`);
    }
    const text = String(value);
    if (text.length > 4096) throw new AgentError(400, "INVALID_ENV", `Environment value for ${key} is too long`);
    clean[key] = text;
  }
  return clean;
}

function assertLabels(labels) {
  if (labels === undefined || labels === null) return {};
  if (typeof labels !== "object" || Array.isArray(labels)) {
    throw new AgentError(400, "INVALID_LABELS", "labels must be an object");
  }
  const clean = {};
  for (const [key, value] of Object.entries(labels)) {
    if (!/^sitedock\.[a-z0-9.-]{1,60}$/.test(key)) {
      throw new AgentError(400, "INVALID_LABELS", `Only sitedock.* labels are allowed: ${key}`);
    }
    const text = String(value);
    if (text.length > 128) throw new AgentError(400, "INVALID_LABELS", `Label ${key} is too long`);
    clean[key] = text;
  }
  return clean;
}

function readBody(req) {
  return new Promise((resolvePromise, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new AgentError(413, "PAYLOAD_TOO_LARGE", "Request body exceeds 8 MiB"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (chunks.length === 0) return resolvePromise({});
      try {
        resolvePromise(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new AgentError(400, "INVALID_JSON", "Request body must be valid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function send(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  res.end(body);
}

async function buildImage(body) {
  const tag = assertImageTag(body.tag);
  const dockerfile = body.dockerfile;
  if (typeof dockerfile !== "string" || dockerfile.trim().length === 0) {
    throw new AgentError(400, "INVALID_DOCKERFILE", "dockerfile content is required");
  }
  if (dockerfile.length > 64 * 1024) {
    throw new AgentError(413, "DOCKERFILE_TOO_LARGE", "dockerfile exceeds 64 KiB");
  }
  if (!/^\s*(#.*\n\s*)*FROM\s+/im.test(dockerfile)) {
    throw new AgentError(400, "INVALID_DOCKERFILE", "dockerfile must contain a FROM instruction");
  }

  const buildDir = await mkdtemp(join(tmpdir(), "sitedock-build-"));
  try {
    await writeFile(join(buildDir, "Dockerfile"), dockerfile, { mode: 0o600 });
    const files = body.files ?? {};
    if (typeof files !== "object" || Array.isArray(files)) {
      throw new AgentError(400, "INVALID_CONTEXT", "files must be an object of path -> base64 content");
    }
    let total = 0;
    for (const [name, encoded] of Object.entries(files)) {
      const target = assertPathWithin(buildDir, name);
      if (typeof encoded !== "string") {
        throw new AgentError(400, "INVALID_CONTEXT", `Context file ${name} must be base64 text`);
      }
      const content = Buffer.from(encoded, "base64");
      total += content.length;
      if (total > 6 * 1024 * 1024) {
        throw new AgentError(413, "CONTEXT_TOO_LARGE", "Build context exceeds 6 MiB");
      }
      const parent = target.slice(0, target.lastIndexOf(sep));
      if (parent) await mkdir(parent, { recursive: true });
      await writeFile(target, content, { mode: 0o644 });
    }

    const pullArgs = await buildPullArgs();
    const buildArgs = () => [
      "build",
      ...pullArgs,
      "--network=none",
      "--label",
      "sitedock.managed=true",
      ...(buildNoNewPrivileges ? ["--security-opt", "no-new-privileges"] : []),
      "--memory",
      "512m",
      "-t",
      tag,
      "-f",
      join(buildDir, "Dockerfile"),
      buildDir,
    ];
    const buildOptions = { timeoutMs: BUILD_TIMEOUT_MS, maxOutput: 512 * 1024 };
    let attempt = await runPodman(buildArgs(), buildOptions);
    if (attempt.code !== 0 && buildNoNewPrivileges && isUnsupportedBuildNoNewPrivileges(attempt.stderr)) {
      buildNoNewPrivileges = false;
      log("build-no-new-privileges-unsupported", {});
      attempt = null;
    }
    const result = attempt ?? (await podman(buildArgs(), buildOptions));
    if (result.code !== 0) {
      throw new AgentError(
        500,
        "RUNTIME_COMMAND_FAILED",
        `podman build failed (${result.code}): ${(result.stderr || result.stdout).slice(-2000)}`
      );
    }
    const inspected = await podman(["image", "inspect", tag]);
    const parsed = JSON.parse(inspected.stdout)[0];
    const digest = parsed.Digest || (parsed.RepoDigests ?? [])[0]?.split("@")[1] || parsed.Id;
    return {
      tag,
      imageId: parsed.Id,
      digest,
      buildLog: `${result.stdout}\n${result.stderr}`.trim().slice(-200_000),
    };
  } finally {
    await rm(buildDir, { recursive: true, force: true });
  }
}

async function createContainer(body) {
  const image = assertImage(body.image);
  const name = assertName(body.name);
  const containerPort = body.containerPort;
  if (!Number.isInteger(containerPort) || containerPort < 1 || containerPort > 65535) {
    throw new AgentError(400, "INVALID_PORT", "containerPort must be 1..65535");
  }
  const env = assertEnv(body.env);
  const labels = assertLabels(body.labels);
  const memoryLimit = assertMemory(body.memoryLimit);
  const cpuLimit = assertCpu(body.cpuLimit);
  const pidsLimit = assertPids(body.pidsLimit);
  const readonlyRoot = body.readonlyRoot === true;

  const existing = await runPodman(["container", "exists", name]);
  if (existing.code === 0) {
    const data = await inspectContainer(name);
    const summary = containerSummary(data);
    if (summary.running) {
      rememberSummary(summary);
      return { ...summary, reused: true };
    }
    throw new AgentError(
      409,
      "CONTAINER_NAME_CONFLICT",
      `Container ${name} exists but is not running (status ${summary.status})`
    );
  }

  const args = [
    "run",
    "-d",
    "--name",
    name,
    "--pull=never",
    "--restart=no",
    "--memory",
    memoryLimit,
    "--cpus",
    cpuLimit,
    "--pids-limit",
    String(pidsLimit),
    "--security-opt",
    "no-new-privileges",
    "--cap-drop",
    "ALL",
    "--label",
    "sitedock.managed=true",
  ];

  // Rootless Podman is already contained, but keep an explicit user namespace
  // mapping so container root is never host root even if the agent is started
  // by a privileged supervisor.
  args.push("--userns=auto");

  for (const [key, value] of Object.entries(labels)) args.push("--label", `${key}=${value}`);
  for (const [key, value] of Object.entries(env)) args.push("-e", `${key}=${value}`);
  args.push("-p", `127.0.0.1::${containerPort}`);

  if (readonlyRoot) {
    args.push("--read-only", "--tmpfs", "/tmp:rw,noexec,nosuid,size=64m", "--tmpfs", "/run:rw,noexec,nosuid,size=16m");
  }

  args.push(image);

  const result = await podman(args, { timeoutMs: 60_000 });
  const id = result.stdout.trim();
  if (!/^[a-f0-9]{12,64}$/.test(id)) {
    throw new AgentError(500, "RUNTIME_BAD_RESPONSE", "podman run did not return a valid container id");
  }
  const data = await inspectContainer(id);
  const summary = containerSummary(data);
  rememberSummary(summary);
  return { ...summary, id, reused: false };
}

async function containerHealth(nameOrId, searchParams) {
  const path = searchParams.get("path") ?? "/health";
  if (!path.startsWith("/") || path.length > 512 || /[\r\n]/.test(path)) {
    throw new AgentError(400, "INVALID_HEALTH_PATH", "Health path must start with / and be a single line");
  }
  const timeoutMs = Math.min(Math.max(Number(searchParams.get("timeoutMs") ?? 1500), 100), 10_000);
  const summary = await cachedContainerSummary(nameOrId);
  if (!summary.running || !summary.hostPort) {
    return { healthy: false, reason: "runtime-not-running", container: summary };
  }

  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`http://127.0.0.1:${summary.hostPort}${path}`, {
      signal: controller.signal,
      redirect: "manual",
    });
    const body = (await res.text()).slice(0, 4096);
    return {
      healthy: res.status >= 200 && res.status < 400,
      statusCode: res.status,
      body,
      elapsedMs: Date.now() - started,
      container: summary,
    };
  } catch (err) {
    return {
      healthy: false,
      reason: err?.name === "AbortError" ? "timeout" : "unreachable",
      elapsedMs: Date.now() - started,
      container: summary,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function listManaged(searchParams) {
  const deploymentId = searchParams.get("deploymentId");
  const args = ["ps", "-a", "--filter", "label=sitedock.managed=true", "--format", "json"];
  const result = await podman(args);
  let rows = [];
  try {
    rows = result.stdout ? JSON.parse(result.stdout) : [];
  } catch {
    rows = [];
  }
  const containers = rows.map((row) => ({
    id: row.Id ?? row.ID,
    name: (row.Names ?? row.Name ?? "").toString().replace(/^\//, ""),
    status: row.Status ?? row.State ?? "unknown",
    labels: row.Labels ?? {},
  }));
  return {
    containers: deploymentId
      ? containers.filter((c) => c.labels["sitedock.deployment.id"] === deploymentId)
      : containers,
  };
}

const server = http.createServer(async (req, res) => {
  const started = Date.now();
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);
  let status = 200;
  try {
    if (req.method === "GET" && url.pathname === "/healthz") {
      const version = await runPodman(["--version"], { timeoutMs: 5000 });
      if (version.code !== 0) throw new AgentError(503, "RUNTIME_UNAVAILABLE", "podman is not available");
      send(res, 200, { status: "ok", podman: version.stdout });
      return;
    }

    assertToken(req);

    if (req.method === "GET" && url.pathname === "/v1/containers") {
      send(res, 200, await listManaged(url.searchParams));
      return;
    }

    if (req.method === "POST" && url.pathname === "/v1/images/build") {
      const body = await readBody(req);
      const result = await buildImage(body);
      log("image-built", { tag: result.tag, imageId: result.imageId });
      send(res, 201, result);
      return;
    }

    if (req.method === "POST" && url.pathname === "/v1/containers") {
      const body = await readBody(req);
      const result = await createContainer(body);
      log("container-started", { containerId: result.id, name: result.name, hostPort: result.hostPort, reused: result.reused });
      send(res, result.reused ? 200 : 201, result);
      return;
    }

    const containerMatch = url.pathname.match(/^\/v1\/containers\/([^/]+)(\/logs|\/health|\/stop)?$/);
    if (containerMatch) {
      const rawId = decodeURIComponent(containerMatch[1]);
      const action = containerMatch[2];
      const idOrName = rawId.startsWith("sitedock-") ? assertName(rawId) : assertContainerId(rawId);

      if (req.method === "GET" && !action) {
        send(res, 200, containerSummary(await inspectContainer(idOrName)));
        return;
      }
      if (req.method === "GET" && action === "/logs") {
        const tail = Math.min(Math.max(Number(url.searchParams.get("tail") ?? 200), 1), 1000);
        const result = await podman(["logs", "--tail", String(tail), idOrName]);
        send(res, 200, { logs: `${result.stdout}\n${result.stderr}`.trim().slice(-200_000) });
        return;
      }
      if (req.method === "GET" && action === "/health") {
        send(res, 200, await containerHealth(idOrName, url.searchParams));
        return;
      }
      if (req.method === "POST" && action === "/stop") {
        const data = await inspectContainer(idOrName);
        if (data?.State?.Running) await podman(["stop", "-t", "10", idOrName], { timeoutMs: 90_000 });
        forgetSummary(idOrName);
        const summary = containerSummary(await inspectContainer(idOrName));
        rememberSummary(summary);
        send(res, 200, summary);
        return;
      }
      if (req.method === "DELETE" && !action) {
        // Removing a running container has to stop it first; on slow hosts that
        // legitimately exceeds the old 20s ceiling and left orphans behind.
        await podman(["rm", "-f", idOrName], { timeoutMs: 90_000 });
        forgetSummary(idOrName);
        send(res, 200, { removed: true, id: idOrName });
        return;
      }
    }

    throw new AgentError(404, "NOT_FOUND", "Unknown runtime-agent route");
  } catch (err) {
    status = err instanceof AgentError ? err.status : 500;
    log("request-error", {
      code: err instanceof AgentError ? err.code : "INTERNAL_ERROR",
      message: err?.message,
    });
    if (!res.headersSent) {
      send(res, status, {
        error: {
          code: err instanceof AgentError ? err.code : "INTERNAL_ERROR",
          message: err?.message ?? "Runtime agent failure",
        },
      });
    }
  } finally {
    log("request", { method: req.method, path: url.pathname, status, durationMs: Date.now() - started });
  }
});

server.requestTimeout = 360_000;
server.headersTimeout = 30_000;
server.listen(PORT, HOST, () => {
  log("listening", { host: HOST, port: PORT, uid: process.getuid?.() ?? null });
});

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    log("shutdown", { signal });
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
  });
}
