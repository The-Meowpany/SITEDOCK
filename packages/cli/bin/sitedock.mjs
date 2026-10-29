#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { basename } from "node:path";

const HELP = `SiteDock CLI

Usage:
  sitedock whoami
  sitedock workspaces
  sitedock sites list
  sitedock domains list <websiteId>
  sitedock domains verify <websiteId> <domainId>
  sitedock domains check <websiteId> <domainId>
  sitedock deploy <websiteId> <file.zip>
  sitedock tokens list

Environment:
  SITEDOCK_API_URL       API base URL (default http://localhost:4000)
  SITEDOCK_API_TOKEN     workspace API token (sitedock_pat_...)
  SITEDOCK_WORKSPACE_ID  default workspace for scoped commands

Flags:
  --api <url>            override API base URL
  --token <token>        override API token
  --workspace <id>       override workspace
  --json                 print raw JSON
  --help                 show this help
`;

const argv = process.argv.slice(2);

function takeFlag(name) {
  const index = argv.indexOf(name);
  if (index === -1) return undefined;
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  argv.splice(index, 2);
  return value;
}

const jsonOutput = argv.includes("--json");
if (jsonOutput) argv.splice(argv.indexOf("--json"), 1);

if (argv.includes("--help") || argv.includes("-h") || argv.length === 0) {
  process.stdout.write(HELP);
  process.exit(0);
}

const apiUrl = (takeFlag("--api") ?? process.env.SITEDOCK_API_URL ?? "http://localhost:4000").replace(/\/$/, "");
const token = takeFlag("--token") ?? process.env.SITEDOCK_API_TOKEN ?? "";
const defaultWorkspace = takeFlag("--workspace") ?? process.env.SITEDOCK_WORKSPACE_ID ?? "";

function workspaceId(explicit) {
  const id = explicit ?? defaultWorkspace;
  if (!id) throw new Error("Missing workspace id. Pass --workspace or set SITEDOCK_WORKSPACE_ID.");
  return id;
}

async function request(path, init = {}) {
  const headers = { ...(init.headers ?? {}) };
  if (token) headers.authorization = `Bearer ${token}`;
  if (init.body && !(init.body instanceof FormData) && !headers["content-type"]) {
    headers["content-type"] = "application/json";
  }

  const response = await fetch(`${apiUrl}${path}`, { ...init, headers });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const message = body?.message ?? body?.code ?? response.statusText;
    throw new Error(`${response.status} ${message}`);
  }
  return body;
}

function print(value) {
  if (jsonOutput) {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) print(item);
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      if (entry === null || entry === undefined) continue;
      process.stdout.write(`${key}: ${typeof entry === "object" ? JSON.stringify(entry) : entry}\n`);
    }
    return;
  }
  process.stdout.write(`${value}\n`);
}

async function main() {
  const [command, subcommand, ...rest] = argv;

  if (command === "whoami") {
    print(await request("/api/v1/auth/me"));
    return;
  }

  if (command === "workspaces") {
    print(await request("/api/v1/workspaces"));
    return;
  }

  if (command === "sites" && subcommand === "list") {
    const id = workspaceId(rest[0]);
    print(await request(`/api/v1/workspaces/${encodeURIComponent(id)}/websites`));
    return;
  }

  if (command === "domains" && (subcommand === "list" || subcommand === "verify" || subcommand === "check")) {
    const id = workspaceId(rest[0]);
    const websiteId = rest[1];
    if (!websiteId) throw new Error("Missing website id.");
    const base = `/api/v1/workspaces/${encodeURIComponent(id)}/websites/${encodeURIComponent(websiteId)}/domains`;

    if (subcommand === "list") {
      print(await request(base));
      return;
    }

    const domainId = rest[2];
    if (!domainId) throw new Error("Missing domain id.");
    print(
      await request(`${base}/${encodeURIComponent(domainId)}/${subcommand}`, {
        method: "POST",
        body: "{}",
      })
    );
    return;
  }

  if (command === "deploy") {
    const id = workspaceId(rest[0]);
    const websiteId = rest[1];
    const filePath = rest[2];
    if (!websiteId || !filePath) throw new Error("Usage: sitedock deploy <websiteId> <file.zip>");
    const file = await readFile(filePath);
    const form = new FormData();
    form.append("file", new Blob([file], { type: "application/zip" }), basename(filePath));
    print(
      await request(
        `/api/v1/workspaces/${encodeURIComponent(id)}/websites/${encodeURIComponent(websiteId)}/deployments`,
        { method: "POST", body: form }
      )
    );
    return;
  }

  if (command === "tokens" && subcommand === "list") {
    const id = workspaceId(rest[0]);
    print(await request(`/api/v1/workspaces/${encodeURIComponent(id)}/api-tokens`));
    return;
  }

  throw new Error(`Unknown command: ${[command, subcommand].filter(Boolean).join(" ")}\n\n${HELP}`);
}

main().catch((err) => {
  process.stderr.write(`sitedock: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
