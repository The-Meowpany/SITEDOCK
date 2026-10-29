#!/usr/bin/env node
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const API = process.env.API_URL ?? "http://127.0.0.1:4000";
const BASE_DOMAIN = process.env.SITEDOCK_BASE_DOMAIN ?? "sitedock.local";
const API_V1 = API + "/api/v1";
const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, "samples", "reference-app");

const runId = Date.now().toString(36);
const email = "envtest-" + runId + "@example.test";
const password = "EnvTest-pass-" + runId;

let cookie = "";

function log(step, data) {
  if (!data) data = {};
  console.log(JSON.stringify(Object.assign({ ts: new Date().toISOString(), step }, data)));
}

async function api(method, route, body) {
  const res = await fetch(API_V1 + route, {
    method,
    headers: Object.assign({
      "content-type": "application/json"
    }, cookie ? { cookie } : {}),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookies = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
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
    throw new Error(method + " " + route + " -> " + res.status + ": " + JSON.stringify(payload));
  }
  return payload;
}

function requestHost(host, requestPath) {
  if (!requestPath) requestPath = "/";
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: Number(process.env.API_PORT ?? 4000),
        path: requestPath,
        method: "GET",
        headers: { host: host },
        timeout: 10000,
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: body }));
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
    .replace('const REVISION = "1";', "const REVISION = \"" + revision + "\";");
  return {
    dockerfile: fs.readFileSync(path.join(appDir, "Dockerfile"), "utf8"),
    contextFiles: {
      "server.js": Buffer.from(server, "utf8").toString("base64"),
    },
  };
}

async function waitForDeployment(workspaceId, serviceId, deploymentId, timeoutMs) {
  if (!timeoutMs) timeoutMs = 300000;
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try {
      const deployments = await api("GET", "/workspaces/" + workspaceId + "/services/" + serviceId + "/deployments");
      last = deployments.find((d) => d.id === deploymentId);
      if (last && ["READY", "FAILED", "CANCELED"].includes(last.status)) return last;
    } catch (e) {}
    await new Promise((r) => setTimeout(r, 2000));
  }
  return last;
}

async function waitForServiceActive(workspaceId, serviceId, deploymentId, timeoutMs) {
  if (!timeoutMs) timeoutMs = 120000;
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try {
      last = await api("GET", "/workspaces/" + workspaceId + "/services/" + serviceId);
      if (last && last.status === "LIVE" && last.activeDeploymentId === deploymentId) return last;
    } catch (e) {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  return last;
}

async function waitForBody(host, predicate, timeoutMs) {
  if (!timeoutMs) timeoutMs = 120000;
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
    await new Promise((r) => setTimeout(r, 2000));
  }
  return last;
}

async function main() {
  log("start", { api: API });
  await api("POST", "/auth/register", { email: email, password: password, fullName: "Env Tester" });
  await api("POST", "/auth/login", { email: email, password: password });
  const workspace = await api("POST", "/workspaces", { name: "EnvTest " + runId });
  const workspaceId = workspace.workspaceId;
  const project = await api("POST", "/workspaces/" + workspaceId + "/projects", { name: "Env Project " + runId });
  const projectId = project.projectId;
  log("created", { workspaceId: workspaceId, projectId: projectId });

  const prodEnv = await api("POST", "/workspaces/" + workspaceId + "/projects/" + projectId + "/environments", {
    name: "Production",
    slug: "production",
    type: "PRODUCTION",
    isDefault: true
  });
  log("env-created", { envId: prodEnv.id, name: prodEnv.name });
  
  const stagingEnv = await api("POST", "/workspaces/" + workspaceId + "/projects/" + projectId + "/environments", {
    name: "Staging",
    slug: "staging", 
    type: "STAGING",
    isDefault: false
  });
  log("env-created", { envId: stagingEnv.id, name: stagingEnv.name });

  const prodHostname = "prod-" + runId;
  const v1 = readReferenceContext(1);
  const prodService = await api("POST", "/workspaces/" + workspaceId + "/services", {
    projectId: projectId,
    environmentId: prodEnv.id,
    name: "prod-" + runId,
    type: "WEB",
    hostname: prodHostname,
    sourceType: "dockerfile",
    dockerfile: v1.dockerfile,
    contextFiles: v1.contextFiles,
    port: 8080,
    readonlyRoot: true,
    pidsLimit: 128,
    memoryLimit: "256m",
    cpuLimit: "0.5",
  });
  log("service-created", { serviceId: prodService.id, hostname: prodService.hostname, env: "prod" });

  const prodDeploy = await api("POST", "/workspaces/" + workspaceId + "/services/" + prodService.id + "/deploy", {
    idempotencyKey: "prod-v1-" + runId,
  });
  const prodDeployState = await waitForDeployment(workspaceId, prodService.id, prodDeploy.deploymentId);
  log("deployment", { env: "prod", deploymentId: prodDeploy.deploymentId, status: prodDeployState ? prodDeployState.status : null });
  if (!prodDeployState || prodDeployState.status !== "READY") throw new Error("prod deployment failed");
  await waitForServiceActive(workspaceId, prodService.id, prodDeploy.deploymentId);
  const routedProd = await waitForBody(prodHostname + "." + BASE_DOMAIN, function(b) { return b.indexOf("revision=1") >= 0; });
  log("routing", { env: "prod", status: routedProd ? routedProd.status : null, body: routedProd ? routedProd.body.trim() : null });

  const stagingHostname = "stag-" + runId;
  const v2 = readReferenceContext(2);
  const stagingService = await api("POST", "/workspaces/" + workspaceId + "/services", {
    projectId: projectId,
    environmentId: stagingEnv.id,
    name: "stag-" + runId,
    type: "WEB",
    hostname: stagingHostname,
    sourceType: "dockerfile",
    dockerfile: v2.dockerfile,
    contextFiles: v2.contextFiles,
    port: 8080,
    readonlyRoot: true,
    pidsLimit: 128,
    memoryLimit: "256m",
    cpuLimit: "0.5",
  });
  log("service-created", { serviceId: stagingService.id, hostname: stagingService.hostname, env: "staging" });

  const stagingDeploy = await api("POST", "/workspaces/" + workspaceId + "/services/" + stagingService.id + "/deploy", {
    idempotencyKey: "stag-v2-" + runId,
  });
  const stagingDeployState = await waitForDeployment(workspaceId, stagingService.id, stagingDeploy.deploymentId);
  log("deployment", { env: "staging", deploymentId: stagingDeploy.deploymentId, status: stagingDeployState ? stagingDeployState.status : null });
  if (!stagingDeployState || stagingDeployState.status !== "READY") throw new Error("staging deployment failed");
  await waitForServiceActive(workspaceId, stagingService.id, stagingDeploy.deploymentId);
  const routedStaging = await waitForBody(stagingHostname + "." + BASE_DOMAIN, function(b) { return b.indexOf("revision=2") >= 0; });
  log("routing", { env: "staging", status: routedStaging ? routedStaging.status : null, body: routedStaging ? routedStaging.body.trim() : null });

  const prodCheck = await requestHost(prodHostname + "." + BASE_DOMAIN);
  const stagCheck = await requestHost(stagingHostname + "." + BASE_DOMAIN);
  log("simultaneous-check", {
    prod: { status: prodCheck.status, hasRev1: prodCheck.body.indexOf("revision=1") >= 0, hasRev2: prodCheck.body.indexOf("revision=2") >= 0 },
    staging: { status: stagCheck.status, hasRev1: stagCheck.body.indexOf("revision=1") >= 0, hasRev2: stagCheck.body.indexOf("revision=2") >= 0 }
  });

  if (prodCheck.body.indexOf("revision=2") >= 0 || stagCheck.body.indexOf("revision=1") >= 0) {
    throw new Error("Environment isolation violated");
  }

  log("SUCCESS", "Objective A completed - environments isolated");
}

main().catch((e) => {
  console.error("ERR", e.message);
  process.exit(1);
});
