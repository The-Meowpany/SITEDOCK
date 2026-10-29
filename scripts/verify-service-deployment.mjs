#!/usr/bin/env node
/**
 * Service deployment end-to-end acceptance:
 *
 * API -> PostgreSQL queue -> worker claim -> runtime agent (rootless Podman)
 * -> image build -> container run -> health -> fenced activation -> hostname
 * routing -> update -> rollback -> failed deploy protection.
 *
 * Requirements:
 *   - API running on API_URL with DATABASE_URL and RUNTIME_AGENT_* configured
 *   - worker running (or `npm run run-once -w apps/worker` in a loop)
 *   - Podman base image `node:20-alpine` present in the rootless store
 *
 * Usage: node scripts/verify-service-deployment.mjs
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const API = process.env.API_URL ?? "http://127.0.0.1:4000";
const BASE_DOMAIN = process.env.SITEDOCK_BASE_DOMAIN ?? "sitedock.local";
const API_V1 = `${API}/api/v1`;
const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, "..", "samples", "reference-app");

const runId = Date.now().toString(36);
const email = `e2e-${runId}@example.test`;
const password = `E2E-pass-${runId}`;
const hostname = `ref-${runId}`;
const serviceName = `reference-${runId}`;

let cookie = "";

function log(step, data = {}) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), step, ...data }));
}

async function api(method, route, body) {
  const res = await fetch(`${API_V1}${route}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookies = res.headers.getSetCookie?.() ?? [];
  const sid = setCookies.map((c) => c.split(";")[0]).find((c) => c.startsWith("sid="));
  if (sid) cookie = sid;

  const text = await res.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  if (!res.ok) {
    throw new Error(`${method} ${route} -> ${res.status}: ${JSON.stringify(payload)}`);
  }
  return payload;
}

function requestHost(host, requestPath = "/") {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: Number(process.env.API_PORT ?? 4000),
        path: requestPath,
        method: "GET",
        headers: { host },
        timeout: 10_000,
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      }
    );
    req.on("timeout", () => req.destroy(new Error("host request timeout")));
    req.on("error", reject);
    req.end();
  });
}

function readReferenceContext(revision) {
  const server = fs
    .readFileSync(path.join(appDir, "server.js"), "utf8")
    .replace('const REVISION = "1";', `const REVISION = "${revision}";`);
  return {
    dockerfile: fs.readFileSync(path.join(appDir, "Dockerfile"), "utf8"),
    contextFiles: {
      "server.js": Buffer.from(server, "utf8").toString("base64"),
    },
  };
}

async function waitForDeployment(serviceId, deploymentId, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    const deployments = await api("GET", `/workspaces/${workspaceId}/services/${serviceId}/deployments`);
    last = deployments.find((d) => d.id === deploymentId);
    if (last && ["READY", "FAILED", "CANCELED"].includes(last.status)) return last;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return last;
}

async function waitForServiceActive(serviceId, deploymentId, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await api("GET", `/workspaces/${workspaceId}/services/${serviceId}`);
    if (last.status === "LIVE" && last.activeDeploymentId === deploymentId) return last;
    await new Promise((r) => setTimeout(r, 500));
  }
  return last;
}

async function waitForBody(host, predicate, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    try {
      const res = await requestHost(host);
      last = res;
      if (res.status === 200 && predicate(res.body)) return res;
    } catch (err) {
      last = { status: 0, body: String(err) };
    }
    await new Promise((r) => setTimeout(r, 700));
  }
  return last;
}

async function deploymentLogs(serviceId, deploymentId) {
  const logs = await api("GET", `/workspaces/${workspaceId}/services/${serviceId}/logs`);
  return logs.filter((l) => l.deploymentId === deploymentId).map((l) => `${l.level}: ${l.message}`);
}

let workspaceId;
let projectId;
let serviceId;

async function main() {
  log("start", { api: API, hostname: `${hostname}.${BASE_DOMAIN}` });

  await api("POST", "/auth/register", { email, password, fullName: "Deployment Verifier" });
  await api("POST", "/auth/login", { email, password });
  const workspace = await api("POST", "/workspaces", { name: `Verification ${runId}` });
  workspaceId = workspace.workspaceId;
  const project = await api("POST", `/workspaces/${workspaceId}/projects`, { name: `Verification Project ${runId}` });
  projectId = project.projectId;

  const v1 = readReferenceContext(1);
  const created = await api("POST", `/workspaces/${workspaceId}/services`, {
    projectId,
    name: serviceName,
    type: "WEB",
    hostname,
    sourceType: "dockerfile",
    dockerfile: v1.dockerfile,
    contextFiles: v1.contextFiles,
    port: 8080,
    readonlyRoot: true,
    pidsLimit: 128,
    memoryLimit: "256m",
    cpuLimit: "0.5",
  });
  serviceId = created.serviceId ?? created.id;
  log("service-created", { serviceId, hostname: created.hostname });

  const first = await api("POST", `/workspaces/${workspaceId}/services/${serviceId}/deploy`, {
    idempotencyKey: `v1-${runId}`,
  });
  const firstState = await waitForDeployment(serviceId, first.deploymentId);
  log("deployment-v1", { deploymentId: first.deploymentId, status: firstState?.status });
  if (firstState?.status !== "READY") {
    throw new Error(`v1 deployment failed: ${JSON.stringify(firstState)} logs=${JSON.stringify(await deploymentLogs(serviceId, first.deploymentId))}`);
  }

  const serviceAfterV1 = await waitForServiceActive(serviceId, first.deploymentId);
  const routedV1 = await waitForBody(`${hostname}.${BASE_DOMAIN}`, (b) => b.includes("revision=1"));
  log("routing-v1", {
    serviceStatus: serviceAfterV1.status,
    activeDeploymentId: serviceAfterV1.activeDeploymentId,
    httpStatus: routedV1?.status,
    body: routedV1?.body?.trim(),
  });
  if (routedV1?.status !== 200 || !routedV1.body.includes("revision=1")) throw new Error("v1 routing failed");
  if (serviceAfterV1.activeDeploymentId !== first.deploymentId) throw new Error("active deployment is not v1");

  // --- Update to v2 ---
  const v2 = readReferenceContext(2);
  await api("PATCH", `/workspaces/${workspaceId}/services/${serviceId}`, { contextFiles: v2.contextFiles });
  const second = await api("POST", `/workspaces/${workspaceId}/services/${serviceId}/deploy`, {
    idempotencyKey: `v2-${runId}`,
  });
  const secondState = await waitForDeployment(serviceId, second.deploymentId);
  log("deployment-v2", { deploymentId: second.deploymentId, status: secondState?.status });
  if (secondState?.status !== "READY") {
    throw new Error(`v2 deployment failed: ${JSON.stringify(secondState)} logs=${JSON.stringify(await deploymentLogs(serviceId, second.deploymentId))}`);
  }

  const serviceAfterV2 = await waitForServiceActive(serviceId, second.deploymentId);
  const routedV2 = await waitForBody(`${hostname}.${BASE_DOMAIN}`, (b) => b.includes("revision=2"));
  log("routing-v2", {
    serviceStatus: serviceAfterV2.status,
    activeDeploymentId: serviceAfterV2.activeDeploymentId,
    httpStatus: routedV2?.status,
    body: routedV2?.body?.trim(),
  });
  if (routedV2?.status !== 200 || !routedV2.body.includes("revision=2")) throw new Error("v2 routing failed");
  if (serviceAfterV2.activeDeploymentId !== second.deploymentId) throw new Error("active deployment is not v2");

  // --- Rollback to v1 image ---
  const rollback = await api("POST", `/workspaces/${workspaceId}/services/${serviceId}/rollback`, {
    targetVersion: 1,
  });
  const serviceAfterRollback = await waitForServiceActive(serviceId, first.deploymentId);
  const routedRollback = await waitForBody(`${hostname}.${BASE_DOMAIN}`, (b) => b.includes("revision=1"));
  log("rollback", {
    deploymentId: rollback.deploymentId,
    activeDeploymentId: serviceAfterRollback.activeDeploymentId,
    httpStatus: routedRollback?.status,
    body: routedRollback?.body?.trim(),
  });
  if (routedRollback?.status !== 200 || !routedRollback.body.includes("revision=1")) {
    throw new Error("rollback routing failed");
  }
  if (serviceAfterRollback.activeDeploymentId !== first.deploymentId) {
    throw new Error("active deployment is not v1 after rollback");
  }

  // --- Failed v3 must not displace the live v1 ---
  await api("PATCH", `/workspaces/${workspaceId}/services/${serviceId}`, {
    dockerfile: "RUN echo this-is-not-a-dockerfile\n",
  });
  const third = await api("POST", `/workspaces/${workspaceId}/services/${serviceId}/deploy`, {
    idempotencyKey: `v3-${runId}`,
  });
  const thirdState = await waitForDeployment(serviceId, third.deploymentId);
  const routedAfterFailure = await requestHost(`${hostname}.${BASE_DOMAIN}`);
  const serviceAfterFailure = await api("GET", `/workspaces/${workspaceId}/services/${serviceId}`);
  log("failed-deploy-protection", {
    deploymentId: third.deploymentId,
    deploymentStatus: thirdState?.status,
    attempts: thirdState?.attempts,
    error: thirdState?.errorMessage,
    serviceStatus: serviceAfterFailure.status,
    activeDeploymentId: serviceAfterFailure.activeDeploymentId,
    httpStatus: routedAfterFailure.status,
    body: routedAfterFailure.body.trim(),
  });
  if (thirdState?.status !== "FAILED") throw new Error("v3 was not marked FAILED");
  if (serviceAfterFailure.activeDeploymentId !== first.deploymentId) throw new Error("failed v3 displaced v1");
  if (serviceAfterFailure.status !== "LIVE") throw new Error("service is not LIVE after failed deploy");
  if (!routedAfterFailure.body.includes("revision=1")) throw new Error("failed v3 changed routed content");

  log("pass", {
    hostname: `${hostname}.${BASE_DOMAIN}`,
    serviceId,
    projectId,
    workspaceId,
    versions: { v1: first.deploymentId, v2: second.deploymentId, failedV3: third.deploymentId },
  });
}

main().catch(async (err) => {
  console.error(err.stack ?? err);
  if (serviceId) {
    try {
      const deployments = await api("GET", `/workspaces/${workspaceId}/services/${serviceId}/deployments`);
      console.error(JSON.stringify({ deployments }, null, 2));
    } catch {}
  }
  process.exitCode = 1;
});
