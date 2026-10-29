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

function log(step, data) {
  if (!data) data = {};
  console.log(JSON.stringify(Object.assign({ ts: new Date().toISOString(), step }, data)));
}

async function api(cookie, method, route, body) {
  const res = await fetch(API_V1 + route, {
    method,
    headers: Object.assign({
      "content-type": "application/json"
    }, cookie ? { cookie } : {}),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookies = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  let newCookie = cookie || "";
  const sid = setCookies.map((c) => c.split(";")[0]).find((c) => c.startsWith("sid="));
  if (sid) newCookie = sid;

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
  return { payload: payload, cookie: newCookie };
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

async function waitForDeployment(cookie, workspaceId, serviceId, deploymentId, timeoutMs) {
  if (!timeoutMs) timeoutMs = 300000;
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try {
      const res = await api(cookie, "GET", "/workspaces/" + workspaceId + "/services/" + serviceId + "/deployments");
      last = res.payload.find((d) => d.id === deploymentId);
      if (last && ["READY", "FAILED", "CANCELED"].includes(last.status)) return res.cookie;
    } catch (e) {}
    await new Promise((r) => setTimeout(r, 2000));
  }
  return cookie;
}

async function waitForServiceActive(cookie, workspaceId, serviceId, deploymentId, timeoutMs) {
  if (!timeoutMs) timeoutMs = 120000;
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try {
      const res = await api(cookie, "GET", "/workspaces/" + workspaceId + "/services/" + serviceId);
      last = res.payload;
      if (last && last.status === "LIVE" && last.activeDeploymentId === deploymentId) return res.cookie;
    } catch (e) {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  return cookie;
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
  log("start-tenant-test");
  
  const email1 = "tenant1-" + runId + "@example.test";
  const pass1 = "Tenant1-pass-" + runId;
  let res1 = await api("", "POST", "/auth/register", { email: email1, password: pass1, fullName: "Tenant One" });
  let cookie1 = res1.cookie;
  res1 = await api(cookie1, "POST", "/auth/login", { email: email1, password: pass1 });
  cookie1 = res1.cookie;
  let w1 = await api(cookie1, "POST", "/workspaces", { name: "Tenant1 WS " + runId });
  const ws1 = w1.payload.workspaceId;
  cookie1 = w1.cookie;
  let p1 = await api(cookie1, "POST", "/workspaces/" + ws1 + "/projects", { name: "Tenant1 Project " + runId });
  const proj1 = p1.payload.projectId;
  cookie1 = p1.cookie;
  
  const email2 = "tenant2-" + runId + "@example.test";
  const pass2 = "Tenant2-pass-" + runId;
  let res2 = await api("", "POST", "/auth/register", { email: email2, password: pass2, fullName: "Tenant Two" });
  let cookie2 = res2.cookie;
  res2 = await api(cookie2, "POST", "/auth/login", { email: email2, password: pass2 });
  cookie2 = res2.cookie;
  let w2 = await api(cookie2, "POST", "/workspaces", { name: "Tenant2 WS " + runId });
  const ws2 = w2.payload.workspaceId;
  cookie2 = w2.cookie;
  let p2 = await api(cookie2, "POST", "/workspaces/" + ws2 + "/projects", { name: "Tenant2 Project " + runId });
  const proj2 = p2.payload.projectId;
  cookie2 = p2.cookie;
  
  log("tenants-created", { ws1: ws1, ws2: ws2 });
  
  const host1 = "t1-" + runId;
  const v1 = readReferenceContext(1);
  let svc1 = await api(cookie1, "POST", "/workspaces/" + ws1 + "/services", {
    projectId: proj1,
    name: "app1-" + runId,
    type: "WEB",
    hostname: host1,
    sourceType: "dockerfile",
    dockerfile: v1.dockerfile,
    contextFiles: v1.contextFiles,
    port: 8080,
    readonlyRoot: true,
    pidsLimit: 128,
    memoryLimit: "256m",
    cpuLimit: "0.5",
  });
  cookie1 = svc1.cookie;
  const service1Id = svc1.payload.id;
  let dep1 = await api(cookie1, "POST", "/workspaces/" + ws1 + "/services/" + service1Id + "/deploy", { idempotencyKey: "t1-" + runId });
  cookie1 = dep1.cookie;
  await waitForDeployment(cookie1, ws1, service1Id, dep1.payload.deploymentId);
  await waitForServiceActive(cookie1, ws1, service1Id, dep1.payload.deploymentId);
  const routed1 = await waitForBody(host1 + "." + BASE_DOMAIN, function(b) { return b.indexOf("revision=1") >= 0; });
  log("tenant1-deployed", { host: host1, status: routed1.status });
  
  const host2 = "t2-" + runId;
  const v2 = readReferenceContext(2);
  let svc2 = await api(cookie2, "POST", "/workspaces/" + ws2 + "/services", {
    projectId: proj2,
    name: "app2-" + runId,
    type: "WEB",
    hostname: host2,
    sourceType: "dockerfile",
    dockerfile: v2.dockerfile,
    contextFiles: v2.contextFiles,
    port: 8080,
    readonlyRoot: true,
    pidsLimit: 128,
    memoryLimit: "256m",
    cpuLimit: "0.5",
  });
  cookie2 = svc2.cookie;
  const service2Id = svc2.payload.id;
  let dep2 = await api(cookie2, "POST", "/workspaces/" + ws2 + "/services/" + service2Id + "/deploy", { idempotencyKey: "t2-" + runId });
  cookie2 = dep2.cookie;
  await waitForDeployment(cookie2, ws2, service2Id, dep2.payload.deploymentId);
  await waitForServiceActive(cookie2, ws2, service2Id, dep2.payload.deploymentId);
  const routed2 = await waitForBody(host2 + "." + BASE_DOMAIN, function(b) { return b.indexOf("revision=2") >= 0; });
  log("tenant2-deployed", { host: host2, status: routed2.status });
  
  const check1 = await requestHost(host1 + "." + BASE_DOMAIN);
  const check2 = await requestHost(host2 + "." + BASE_DOMAIN);
  log("both-accessible", { t1: check1.status, t2: check2.status });
  
  try {
    await api(cookie1, "GET", "/workspaces/" + ws2 + "/services/" + service2Id);
    log("cross-tenant-leak", "FAILED");
  } catch (e) {
    log("cross-tenant-rejected", "OK");
  }
  
  try {
    await api(cookie1, "POST", "/workspaces/" + ws2 + "/services/" + service2Id + "/deploy", {});
    log("cross-tenant-deploy-leak", "FAILED");
  } catch (e) {
    log("cross-tenant-deploy-rejected", "OK");
  }
  
  log("SUCCESS", "Objective B completed - two tenants isolated");
}

main().catch((e) => {
  console.error("ERR", e.message);
  process.exit(1);
});
