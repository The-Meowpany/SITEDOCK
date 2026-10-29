import { createHmac, randomUUID, sign, timingSafeEqual } from "node:crypto";

/**
 * GitHub App configuration read from environment variables.
 * All values are optional in local development; operations that need a missing
 * value fail with an explicit error instead of silently using a placeholder.
 */
const GITHUB_APP_CLIENT_ID = process.env.GITHUB_APP_CLIENT_ID || "";
const GITHUB_APP_CLIENT_SECRET = process.env.GITHUB_APP_CLIENT_SECRET || "";
const GITHUB_REDIRECT_URI =
  process.env.GITHUB_REDIRECT_URI || "http://localhost:3000/api/v1/github/callback";
const GITHUB_APP_PRIVATE_KEY = (process.env.GITHUB_APP_PRIVATE_KEY || "").replace(/\\n/g, "\n");

const GITHUB_OAUTH_BASE = "https://github.com/login/oauth";
const GITHUB_API_BASE = "https://api.github.com";

export interface RepositoryConnection {
  id: string;
  organizationId: string;
  websiteId: string;
  serviceId?: string | null;
  installationId: string;
  repositoryId: string;
  repositoryName: string;
  repositoryFullName: string;
  defaultBranch: string;
  webhookSecret: string;
  pinnedCommitSha?: string | null;
}

export interface RepositorySummary {
  id: string;
  name: string;
  fullName: string;
  private: boolean;
}

function githubHeaders(token: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    "user-agent": "SiteDock",
  };
}

/** Generates the GitHub App authorization URL, with a unique state nonce. */
export function initiateInstall(): string {
  const state = randomUUID();
  const redirectUri = encodeURIComponent(GITHUB_REDIRECT_URI);
  return (
    `${GITHUB_OAUTH_BASE}/authorize?` +
    `client_id=${encodeURIComponent(GITHUB_APP_CLIENT_ID)}` +
    `&scope=repo,read:webhook` +
    `&redirect_uri=${redirectUri}` +
    `&state=${state}`
  );
}

/** Exchanges an OAuth authorization code for an installation access token. */
export async function exchangeCodeForToken(
  code: string
): Promise<{ installationId: string; token: string }> {
  if (!GITHUB_APP_CLIENT_ID || !GITHUB_APP_CLIENT_SECRET) {
    throw new Error("GitHub App client credentials are not configured");
  }

  const params = new URLSearchParams({
    client_id: GITHUB_APP_CLIENT_ID,
    client_secret: GITHUB_APP_CLIENT_SECRET,
    code,
    redirect_uri: GITHUB_REDIRECT_URI,
  });

  const response = await fetch(`${GITHUB_OAUTH_BASE}/access_token`, {
    method: "POST",
    headers: { accept: "application/json" },
    body: params,
  });

  const result = (await response.json()) as {
    error?: string;
    installation_id?: number | string;
    access_token?: string;
    token?: string;
  };

  if (result.error) {
    throw new Error(`GitHub OAuth error: ${result.error}`);
  }

  const installationId = result.installation_id?.toString() || "";
  const token = result.access_token || result.token || "";
  if (!installationId || !token) {
    throw new Error("Missing installation ID or token from GitHub OAuth response");
  }

  return { installationId, token };
}

/** Parses the SiteDock installation token format `installationId:appId:token`. */
export function parseInstallationToken(token: string): {
  installationId: string;
  appId: string;
  token: string;
} {
  const parts = token.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid installation token format");
  }
  return { installationId: parts[0]!, appId: parts[1]!, token: parts[2]! };
}

/**
 * Mints a short-lived installation access token from the App JWT. Used when
 * the callback only returned an installation id (or when the token fetched by
 * the OAuth exchange must not be reused server-side).
 */
export async function createInstallationToken(
  installationId: string,
  appId?: string
): Promise<{ token: string; expiresAt: string | null }> {
  const jwt = generateJwt("github", appId);
  const response = await fetch(
    `${GITHUB_API_BASE}/app/installations/${encodeURIComponent(installationId)}/access_tokens`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${jwt}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "user-agent": "SiteDock",
      },
    }
  );

  const body = (await response.json().catch(() => null)) as {
    token?: string;
    expires_at?: string;
    message?: string;
  } | null;

  if (!response.ok || !body?.token) {
    throw new Error(
      `Failed to create GitHub installation token: ${response.status} - ${body?.message ?? "unknown error"}`
    );
  }
  return { token: body.token, expiresAt: body.expires_at ?? null };
}

/** Reads one repository through an installation token. */
export async function fetchRepository(
  repositoryId: string,
  token: string
): Promise<RepositorySummary & { defaultBranch: string }> {
  const response = await fetch(`${GITHUB_API_BASE}/repositories/${encodeURIComponent(repositoryId)}`, {
    method: "GET",
    headers: githubHeaders(token),
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch repository ${repositoryId}: ${response.status}`);
  }
  const repo = (await response.json()) as {
    id: number | string;
    name: string;
    full_name: string;
    private: boolean;
    default_branch: string;
  };
  return {
    id: String(repo.id),
    name: repo.name,
    fullName: repo.full_name,
    private: repo.private,
    defaultBranch: repo.default_branch,
  };
}

/** Lists repositories accessible to an installation. */
export async function fetchRepositories(
  installationId: string,
  token: string
): Promise<RepositorySummary[]> {
  const response = await fetch(
    `${GITHUB_API_BASE}/installation/repositories?per_page=100&installation_id=${encodeURIComponent(installationId)}`,
    { method: "GET", headers: githubHeaders(token) }
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to fetch repositories: ${response.status} - ${body.slice(0, 500)}`);
  }

  const data = (await response.json()) as {
    repositories?: Array<{ id: number | string; name: string; full_name: string; private: boolean }>;
  };

  return (data.repositories ?? []).map((repo) => ({
    id: String(repo.id),
    name: repo.name,
    fullName: repo.full_name,
    private: repo.private,
  }));
}

/** Fetches the tree and text files of a repository at an exact ref. */
export async function fetchRepositoryContents(
  installationId: string,
  token: string,
  owner: string,
  repo: string,
  ref: string = "main"
): Promise<{ treeSha: string; dockerfile?: string; contents: Record<string, string> }> {
  const treeUrl = `${GITHUB_API_BASE}/repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`;
  const treeResponse = await fetch(treeUrl, { method: "GET", headers: githubHeaders(token) });

  if (!treeResponse.ok) {
    throw new Error(`Failed to fetch repository tree: ${treeResponse.status}`);
  }

  const treeData = (await treeResponse.json()) as {
    sha: string;
    tree: Array<{ path: string; type: string }>;
  };

  const files: Record<string, string> = {};
  let dockerfile: string | undefined;

  for (const item of treeData.tree) {
    if (item.type !== "blob") continue;
    if (!/\.(ts|js|mjs|cjs|json|css|html|md|txt|yml|yaml)$/i.test(item.path)) continue;

    const contentUrl = `${GITHUB_API_BASE}/repos/${owner}/${repo}/contents/${item.path}?ref=${encodeURIComponent(ref)}`;
    const contentResponse = await fetch(contentUrl, { method: "GET", headers: githubHeaders(token) });
    if (!contentResponse.ok) continue;

    const contentData = (await contentResponse.json()) as { content?: string; encoding?: string };
    if (!contentData.content) continue;

    const decoded = Buffer.from(contentData.content, "base64").toString("utf8");
    files[item.path] = decoded;
    if (item.path === "Dockerfile" || item.path.endsWith("/Dockerfile")) {
      dockerfile = decoded;
    }
  }

  return { treeSha: treeData.sha, dockerfile, contents: files };
}

/**
 * Verifies an `X-Hub-Signature-256` header.
 *
 * GitHub signs the raw request body with HMAC-SHA256 keyed by the connection's
 * webhook secret. The comparison is constant-time and length-checked.
 */
export function verifyWebhookSignature(
  webhookSecret: string,
  payload: Buffer,
  signature: string
): boolean {
  if (!webhookSecret || !signature.startsWith("sha256=")) {
    return false;
  }

  const expected = Buffer.from(
    createHmac("sha256", webhookSecret).update(payload).digest("hex"),
    "utf8"
  );
  const received = Buffer.from(signature.slice(7), "utf8");
  if (expected.length !== received.length) return false;
  return timingSafeEqual(expected, received);
}

function base64Url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Signs a GitHub App JWT (RS256) used for installation authentication.
 * Requires `GITHUB_APP_PRIVATE_KEY`; an unsigned placeholder is never returned.
 */
export function generateJwt(audience: string = "github", appId?: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iat: now - 60,
    exp: now + 540,
    iss: appId ?? process.env.GITHUB_APP_ID ?? "",
    aud: audience,
  };

  if (!GITHUB_APP_PRIVATE_KEY) {
    throw new Error("GITHUB_APP_PRIVATE_KEY is not configured; cannot sign a GitHub App JWT");
  }

  const signingInput = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(claims))}`;
  const signature = sign("RSA-SHA256", Buffer.from(signingInput), GITHUB_APP_PRIVATE_KEY);
  return `${signingInput}.${base64Url(signature)}`;
}

/**
 * Persists a repository connection. The caller passes the Prisma client so this
 * module never owns the database client.
 */
export async function saveRepositoryConnection(
  connection: RepositoryConnection,
  prisma: unknown
): Promise<{ connection: RepositoryConnection }> {
  const client = prisma as {
    gitHubRepositoryConnection?: {
      upsert: (args: unknown) => Promise<unknown>;
    };
  };
  if (!client?.gitHubRepositoryConnection) {
    throw new Error(
      "GitHubRepositoryConnection persistence is not available: the database schema has no GitHub connection model"
    );
  }

  await client.gitHubRepositoryConnection.upsert({
    where: { id: connection.id },
    create: { ...connection },
    update: {
      organizationId: connection.organizationId,
      installationId: connection.installationId,
      repositoryId: connection.repositoryId,
      repositoryName: connection.repositoryName,
      repositoryFullName: connection.repositoryFullName,
      defaultBranch: connection.defaultBranch,
      webhookSecret: connection.webhookSecret,
      pinnedCommitSha: connection.pinnedCommitSha ?? null,
    },
  });

  return { connection };
}

/**
 * Resolves an authorized repository connection by database id, or by the
 * `(installationId, repositoryId)` pair when no id is supplied.
 */
export async function findRepositoryConnection(
  installationIdOrId: string,
  repositoryId: string,
  prisma: unknown
): Promise<RepositoryConnection | null> {
  const client = prisma as {
    gitHubRepositoryConnection?: {
      findFirst: (args: unknown) => Promise<RepositoryConnection | null>;
    };
  };
  if (!client?.gitHubRepositoryConnection) {
    throw new Error(
      "GitHubRepositoryConnection lookup is not available: the database schema has no GitHub connection model"
    );
  }

  return client.gitHubRepositoryConnection.findFirst(
    repositoryId
      ? { where: { installationId: installationIdOrId, repositoryId } }
      : { where: { id: installationIdOrId } }
  );
}

/** Pins (or clears) the exact commit SHA a connection may deploy. */
export async function pinCommitShaForConnection(
  connectionId: string,
  sha: string,
  prisma: unknown
): Promise<{ success: boolean; pinnedSha: string | null }> {
  if (sha !== "" && !/^[0-9a-f]{40}$/.test(sha)) {
    throw new Error(`Invalid commit SHA format: ${sha} (expected 40-char hex)`);
  }

  const client = prisma as {
    gitHubRepositoryConnection?: {
      update: (args: unknown) => Promise<RepositoryConnection>;
    };
  };
  if (!client?.gitHubRepositoryConnection) {
    throw new Error(
      "GitHubRepositoryConnection persistence is not available: the database schema has no GitHub connection model"
    );
  }

  const pinnedCommitSha = sha === "" ? null : sha;
  const updated = await client.gitHubRepositoryConnection.update({
    where: { id: connectionId },
    data: { pinnedCommitSha },
  });
  return { success: true, pinnedSha: updated.pinnedCommitSha ?? null };
}

/** Resolves a branch/ref to an immutable commit SHA through the GitHub API. */
export async function resolveRefToSha(
  installationId: string,
  token: string,
  owner: string,
  ref: string
): Promise<string> {
  void installationId;
  const normalizedRef = ref.startsWith("refs/heads/") ? ref : `heads/${ref}`;
  const response = await fetch(
    `${GITHUB_API_BASE}/repos/${owner}/git/refs/${normalizedRef}`,
    { method: "GET", headers: githubHeaders(token) }
  );

  if (!response.ok) {
    throw new Error(
      `Failed to resolve ref ${ref}: ${response.status} - ${(await response.text()).slice(0, 500)}`
    );
  }

  const data = (await response.json()) as { object?: { sha?: string } };
  if (!data.object?.sha) {
    throw new Error(`Could not resolve ref ${ref} to a commit SHA`);
  }
  return data.object.sha;
}
