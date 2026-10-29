#!/usr/bin/env node
/**
 * Customer/operator journey acceptance against a running local stack (real
 * HTTP, real PostgreSQL, real storage). Complements
 * scripts/verify-service-deployment.mjs (container runtime path).
 *
 *   A  account + workspace: register, login, settings persistence, tenant isolation
 *   B  static website: upload -> approve -> publish -> served by Host header
 *   C  update -> changed response -> rollback
 *   D  custom domain: register -> verify -> Host routing -> Caddy TLS ask
 *   F  backup -> integrity-checked restore as new version -> publish -> served;
 *      tampered backup refused
 *   G  platform admin: non-admin refused, admin inspects and suspends a site
 *
 * Every account and resource is created by this run (unique e-mail/run id);
 * the only out-of-band writes are scoped to those rows/objects: promoting this
 * run's admin account and corrupting this run's own backup object.
 *
 * Requirements: API on API_URL with DATABASE_URL, STORAGE_PROVIDER=disk,
 * STORAGE_DIR, TLS_ASK_SECRET and DOMAIN_PROVIDER=mock (never a live provider).
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const API = process.env.API_URL ?? "http://127.0.0.1:4000";
const API_PORT = Number(new URL(API).port || 80);
const API_V1 = `${API}/api/v1`;
const BASE_DOMAIN = process.env.SITEDOCK_BASE_DOMAIN ?? "sitedock.local";
const runId = Date.now().toString(36);
const results = [];

if (process.env.DOMAIN_PROVIDER && process.env.DOMAIN_PROVIDER !== "mock") {
  console.error("refusing to run: DOMAIN_PROVIDER must be mock (no live DNS changes)");
  process.exit(2);
}

function record(journey, name, ok, detail = {}) {
  results.push({ journey, name, ok });
  console.log(JSON.stringify({ journey, check: name, result: ok ? "PASS" : "FAIL", ...detail }));
}

class Session {
  constructor(label) {
    this.label = label;
    this.cookie = "";
  }
  async call(method, route, body, { raw } = {}) {
    const res = await fetch(`${API_V1}${route}`, {
      method,
      headers: {
        ...(body !== undefined && !raw ? { "content-type": "application/json" } : {}),
        ...(this.cookie ? { cookie: this.cookie } : {}),
      },
      body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
    });
    const sid = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).find((c) => c.startsWith("sid="));
    if (sid) this.cookie = sid;
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = text;
    }
    return { status: res.status, json };
  }
  async must(method, route, body, expected = [200, 201, 204], opts) {
    const r = await this.call(method, route, body, opts);
    if (!expected.includes(r.status)) {
      throw new Error(`${this.label}: ${method} ${route} -> ${r.status} ${JSON.stringify(r.json)}`);
    }
    return r.json;
  }
}

function requestHost(host, requestPath = "/") {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: "127.0.0.1", port: API_PORT, path: requestPath, method: "GET", headers: { host }, timeout: 10_000 },
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

function crc32(buf) {
  let c = -1;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ -1) >>> 0;
}

/** Minimal stored (uncompressed) ZIP, enough for the upload pipeline. */
function zip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.from(content);
    const nameBytes = Buffer.from(name);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    locals.push(local, nameBytes, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Object.keys(files).length, 8);
  eocd.writeUInt16LE(Object.keys(files).length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, eocd]);
}

async function upload(session, workspaceId, websiteId, html) {
  const form = new FormData();
  form.append("file", new Blob([zip({ "index.html": html })], { type: "application/zip" }), "site.zip");
  return session.must("POST", `/workspaces/${workspaceId}/websites/${websiteId}/deployments`, form, [201], {
    raw: true,
  });
}

async function register(label) {
  const session = new Session(label);
  const email = `journey-${label}-${runId}@example.test`;
  const password = `Journey-${runId}-pass`;
  await session.must("POST", "/auth/register", { email, password, fullName: `Journey ${label}` }, [201]);
  await session.must("POST", "/auth/login", { email, password }, [200]);
  session.email = email;
  return session;
}

async function main() {
  console.log(JSON.stringify({ step: "start", api: API, runId }));

  // ── A: account + workspace ────────────────────────────────────────────────
  const owner = await register("owner");
  const outsider = await register("outsider");
  record("A", "register + login issue a session", Boolean(owner.cookie && outsider.cookie));

  const me = await owner.call("GET", "/auth/me");
  record("A", "session resolves the account", me.status === 200 && JSON.stringify(me.json).includes(owner.email), {
    status: me.status,
  });

  const ws = await owner.must("POST", "/workspaces", { name: `Journey ${runId}` }, [201]);
  const workspaceId = ws.workspaceId ?? ws.id;
  const listed = await owner.must("GET", "/workspaces");
  record("A", "workspace persisted and listed", JSON.stringify(listed).includes(workspaceId));

  const branding = { primaryColor: "#123456", companyName: `Journey ${runId}` };
  const patch = await owner.call("PATCH", `/workspaces/${workspaceId}/branding`, { branding });
  const reread = await owner.call("GET", `/workspaces/${workspaceId}`);
  record(
    "A",
    "workspace settings (branding) update persists",
    patch.status === 200 && JSON.stringify(reread.json).includes("#123456"),
    { patchStatus: patch.status, readStatus: reread.status }
  );

  const foreignRead = await outsider.call("GET", `/workspaces/${workspaceId}`);
  const foreignBranding = await outsider.call("PATCH", `/workspaces/${workspaceId}/branding`, { branding });
  const foreignSites = await outsider.call("GET", `/workspaces/${workspaceId}/websites`);
  record(
    "A",
    "non-member cannot read or change another workspace",
    [403, 404].includes(foreignRead.status) &&
      [403, 404].includes(foreignBranding.status) &&
      [403, 404].includes(foreignSites.status),
    { read: foreignRead.status, branding: foreignBranding.status, websites: foreignSites.status }
  );
  const anonymous = await new Session("anon").call("GET", `/workspaces/${workspaceId}`);
  record("A", "anonymous request is rejected", anonymous.status === 401, { status: anonymous.status });

  // ── B: static website deploy + HTTP serving ───────────────────────────────
  const project = await owner.must("POST", `/workspaces/${workspaceId}/projects`, { name: `Journey ${runId}` }, [201]);
  const projectId = project.projectId ?? project.id;
  const site = await owner.must(
    "POST",
    `/workspaces/${workspaceId}/websites`,
    { projectId, name: `Journey Site ${runId}` },
    [201]
  );
  const websiteId = site.websiteId;
  const siteHost = `${site.subdomain}.${BASE_DOMAIN}`;
  const sitePath = `/workspaces/${workspaceId}/websites/${websiteId}`;

  const before = await requestHost(siteHost);
  record("B", "unpublished website is not served", before.status === 404, { status: before.status });

  const v1 = await upload(owner, workspaceId, websiteId, `<h1>journey ${runId} v1</h1>`);
  await owner.must("POST", `${sitePath}/submit-for-approval`);
  await owner.must("POST", `${sitePath}/approve`);
  await owner.must("POST", `${sitePath}/deployments/${v1.deploymentId}/publish`);
  const served1 = await requestHost(siteHost);
  record("B", "published v1 is served on its platform hostname", served1.status === 200 && served1.body.includes("v1"), {
    host: siteHost,
    status: served1.status,
    body: served1.body.slice(0, 80),
  });

  const unknown = await requestHost(`nope-${runId}.${BASE_DOMAIN}`);
  const malformed = await requestHost(`bad_label.${BASE_DOMAIN}`);
  record("B", "unknown and malformed hostnames fail closed", unknown.status === 404 && [400, 404].includes(malformed.status), {
    unknown: unknown.status,
    malformed: malformed.status,
  });

  const foreignUpload = await outsider.call(
    "POST",
    `${sitePath}/deployments`,
    (() => {
      const form = new FormData();
      form.append("file", new Blob([zip({ "index.html": "pwned" })], { type: "application/zip" }), "x.zip");
      return form;
    })(),
    { raw: true }
  );
  record("B", "non-member cannot deploy to the website", [403, 404].includes(foreignUpload.status), {
    status: foreignUpload.status,
  });

  // ── C: update + rollback ──────────────────────────────────────────────────
  const v2 = await upload(owner, workspaceId, websiteId, `<h1>journey ${runId} v2</h1>`);
  await owner.must("POST", `${sitePath}/deployments/${v2.deploymentId}/publish`);
  const served2 = await requestHost(siteHost);
  record("C", "publishing v2 changes the served response", served2.body.includes("v2"), { body: served2.body.slice(0, 80) });

  const badUpload = await owner.call("POST", `${sitePath}/deployments`, (() => {
    const form = new FormData();
    form.append("file", new Blob([Buffer.from("not a zip")], { type: "application/zip" }), "broken.zip");
    return form;
  })(), { raw: true });
  const afterBad = await requestHost(siteHost);
  record("C", "a broken upload is rejected and v2 stays live", badUpload.status >= 400 && afterBad.body.includes("v2"), {
    uploadStatus: badUpload.status,
    served: afterBad.body.slice(0, 80),
  });

  await owner.must("POST", `${sitePath}/rollback`, { targetDeploymentId: v1.deploymentId });
  const rolled = await requestHost(siteHost);
  record("C", "rollback serves v1 again", rolled.body.includes("v1"), { body: rolled.body.slice(0, 80) });

  // ── F: backup + restore ───────────────────────────────────────────────────
  const backup = await owner.must("POST", `${sitePath}/backups`, {}, [200, 201]);
  const backupId = backup.backupId ?? backup.id;
  const backups = await owner.must("GET", `${sitePath}/backups`);
  record("F", "backup created and listed", JSON.stringify(backups).includes(backupId), { backupId });
  record("F", "backup listing hides storage paths", !JSON.stringify(backups).includes("storagePath"));

  // v2 was already published once, so going back to it is a rollback.
  await owner.must("POST", `${sitePath}/rollback`, { targetDeploymentId: v2.deploymentId });
  const restored = await owner.must("POST", `${sitePath}/backups/${backupId}/restore`, {}, [200, 201]);
  const stillV2 = await requestHost(siteHost);
  record("F", "restore creates a new version without going live by itself", Boolean(restored.deploymentId) && stillV2.body.includes("v2"), {
    restoredVersion: restored.version,
  });
  await owner.must("POST", `${sitePath}/deployments/${restored.deploymentId}/publish`);
  const servedRestored = await requestHost(siteHost);
  record("F", "published restore serves the backed-up content", servedRestored.body.includes("v1"), {
    body: servedRestored.body.slice(0, 80),
  });

  const foreignRestore = await outsider.call("POST", `${sitePath}/backups/${backupId}/restore`, {});
  record("F", "non-member cannot restore", [403, 404].includes(foreignRestore.status), { status: foreignRestore.status });

  if (process.env.STORAGE_PROVIDER === "disk" && process.env.STORAGE_DIR) {
    const tampered = await owner.must("POST", `${sitePath}/backups`, { deploymentId: v2.deploymentId }, [200, 201]);
    const tamperedId = tampered.backupId ?? tampered.id;
    const dir = path.join(process.env.STORAGE_DIR, "websites", websiteId, "backups", tamperedId);
    const file = fs.readdirSync(dir, { recursive: true }).map((f) => path.join(dir, f)).find((f) => fs.statSync(f).isFile());
    fs.appendFileSync(file, "<!-- tampered -->");
    const refused = await owner.call("POST", `${sitePath}/backups/${tamperedId}/restore`, {});
    record("F", "tampered backup is refused by the integrity check", refused.status >= 400 && JSON.stringify(refused.json).includes("INTEGRITY"), {
      status: refused.status,
      code: refused.json?.code,
    });
  } else {
    record("F", "tampered backup is refused (skipped: needs disk storage)", false);
  }

  // ── D: custom domain + TLS ask ────────────────────────────────────────────
  const customHost = `www.journey-${runId}.example.test`;
  const domain = await owner.must("POST", `${sitePath}/domains`, { hostname: customHost }, [201]);
  const domainId = domain.domainId ?? domain.id;
  const preVerify = await requestHost(customHost);
  record("D", "unverified custom domain is not routed", preVerify.status === 404, { status: preVerify.status });

  const secret = process.env.TLS_ASK_SECRET ?? "";
  const ask = async (host, s = secret) =>
    (await fetch(`${API}/internal/tls/ask?domain=${encodeURIComponent(host)}&secret=${encodeURIComponent(s)}`)).status;
  const askBefore = await ask(customHost);

  const verified = await owner.must("POST", `${sitePath}/domains/${domainId}/verify`);
  const routed = await requestHost(customHost);
  record("D", "verified custom domain routes to the website", routed.status === 200 && routed.body.includes("v1"), {
    verifyStatus: verified?.status,
    status: routed.status,
  });
  const askAfter = await ask(customHost);
  const askPlatform = await ask(siteHost);
  const askStranger = await ask(`evil-${runId}.example.test`);
  const askBadSecret = await ask(customHost, "wrong-secret");
  record(
    "D",
    "TLS ask allows only owned hosts with the shared secret",
    askBefore !== 200 && askAfter === 200 && askPlatform === 200 && askStranger !== 200 && askBadSecret !== 200,
    { askBefore, askAfter, askPlatform, askStranger, askBadSecret }
  );
  const foreignDomain = await outsider.call("POST", `${sitePath}/domains`, { hostname: `x-${runId}.example.test` });
  record("D", "non-member cannot attach a domain", [403, 404].includes(foreignDomain.status), { status: foreignDomain.status });

  // ── G: platform administration ────────────────────────────────────────────
  const denied = await outsider.call("GET", "/admin/overview");
  record("G", "non-admin is refused platform administration", denied.status === 403, { status: denied.status });

  const admin = await register("admin");
  const prisma = new PrismaClient();
  try {
    const updated = await prisma.user.updateMany({ where: { email: admin.email }, data: { platformRole: "PLATFORM_ADMIN" } });
    if (updated.count !== 1) throw new Error(`expected to promote exactly one account, got ${updated.count}`);
  } finally {
    await prisma.$disconnect();
  }
  const overview = await admin.call("GET", "/admin/overview");
  const adminSites = await admin.call("GET", "/admin/websites");
  record("G", "admin can inspect platform resources", overview.status === 200 && JSON.stringify(adminSites.json).includes(websiteId), {
    overview: overview.status,
    websites: adminSites.status,
  });
  const suspend = await admin.call("POST", `/admin/websites/${websiteId}/suspend`, { reason: "journey verification" });
  const afterSuspend = await requestHost(siteHost);
  record("G", "admin suspension takes the site offline", [200, 204].includes(suspend.status) && afterSuspend.status !== 200, {
    suspend: suspend.status,
    served: afterSuspend.status,
  });
  const audit = await owner.call("GET", `/workspaces/${workspaceId}/audit-logs`);
  record("G", "actions are recorded in the audit log", audit.status === 200 && JSON.stringify(audit.json).length > 2, {
    status: audit.status,
  });

  const failed = results.filter((r) => !r.ok);
  console.log(
    JSON.stringify({ step: failed.length ? "fail" : "pass", passed: results.length - failed.length, failed: failed.length, runId })
  );
  if (failed.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
