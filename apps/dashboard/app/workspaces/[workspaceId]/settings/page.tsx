"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/lib/api-client";
import type { ApiTokenSummary, CreatedApiToken } from "@/lib/api-client";
import { ApiError } from "@/lib/api-error";
import styles from "./page.module.css";

type Scope = "read" | "write";

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en", { dateStyle: "medium" });
}

function tokenState(token: ApiTokenSummary): { label: string; tone: string } {
  if (token.revokedAt) return { label: "Revoked", tone: styles.revoked };
  if (token.expiresAt && new Date(token.expiresAt) <= new Date()) {
    return { label: "Expired", tone: styles.revoked };
  }
  return { label: "Active", tone: styles.active };
}

export default function WorkspaceSettingsPage() {
  const params = useParams<{ workspaceId: string }>();
  const router = useRouter();
  const workspaceId = params.workspaceId;

  const [tokens, setTokens] = useState<ApiTokenSummary[]>([]);
  const [created, setCreated] = useState<CreatedApiToken | null>(null);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<Scope[]>(["read", "write"]);
  const [expiresOn, setExpiresOn] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"create" | string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .listApiTokens(workspaceId)
      .then((list) => !cancelled && setTokens(list))
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) {
          router.replace(`/login?returnTo=/workspaces/${workspaceId}/settings`);
          return;
        }
        if (err instanceof ApiError && err.status === 403) {
          setError("Only OWNER and ADMIN roles can manage API tokens.");
          return;
        }
        setError(err instanceof Error ? err.message : "Could not load API tokens.");
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [workspaceId, router]);

  function toggleScope(scope: Scope) {
    setScopes((current) =>
      current.includes(scope) ? current.filter((value) => value !== scope) : [...current, scope]
    );
  }

  async function createToken(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || scopes.length === 0) return;
    setBusy("create");
    setError(null);
    setNotice(null);
    setCreated(null);
    try {
      const token = await api.createApiToken(workspaceId, {
        name: name.trim(),
        scopes,
        expiresAt: expiresOn ? new Date(`${expiresOn}T23:59:59.999Z`).toISOString() : undefined,
      });
      setCreated(token);
      setTokens((current) => [token, ...current]);
      setName("");
      setExpiresOn("");
      setNotice("Token created. Copy it now; it will not be shown again.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the token.");
    } finally {
      setBusy(null);
    }
  }

  async function revokeToken(token: ApiTokenSummary) {
    if (busy) return;
    if (!window.confirm(`Revoke the token "${token.name}"? This action cannot be undone.`)) {
      return;
    }
    setBusy(token.id);
    setError(null);
    setNotice(null);
    try {
      await api.revokeApiToken(workspaceId, token.id);
      setTokens((current) =>
        current.map((item) =>
          item.id === token.id ? { ...item, revokedAt: new Date().toISOString() } : item
        )
      );
      if (created?.id === token.id) setCreated(null);
      setNotice(`Token "${token.name}" revoked.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not revoke the token.");
    } finally {
      setBusy(null);
    }
  }

  async function copyToken() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.token);
      setNotice("Token copied to the clipboard.");
    } catch {
      setError("Could not copy the token. Select it manually.");
    }
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Workspace settings</p>
          <h1 className={styles.title}>API tokens</h1>
        </div>
      </header>

      <p className={styles.intro}>
        Tokens let you automate deployments, domains and queries from the CLI or your own scripts.
        Each token is limited to this workspace and to the scopes you select.
      </p>

      {error && <p className={styles.error}>{error}</p>}
      {notice && <p className={styles.notice}>{notice}</p>}

      {created && (
        <section className={styles.secretPanel} aria-label="Newly created token">
          <h2 className={styles.panelTitle}>Copy your token now</h2>
          <p className={styles.secretHint}>
            For security, the full value is never shown again. Store it in your secret manager.
          </p>
          <div className={styles.secretRow}>
            <code className={styles.secret}>{created.token}</code>
            <button type="button" className={styles.button} onClick={copyToken}>
              Copy
            </button>
          </div>
        </section>
      )}

      <div className={styles.grid}>
        <section className={styles.panel} aria-label="Create API token">
          <h2 className={styles.panelTitle}>New token</h2>
          <form className={styles.form} onSubmit={createToken}>
            <label className={styles.label}>
              Name
              <input
                className={styles.input}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="CI deploy"
                maxLength={80}
                required
              />
            </label>

            <fieldset className={styles.fieldset}>
              <legend className={styles.legend}>Scopes</legend>
              <label className={styles.check}>
                <input
                  type="checkbox"
                  checked={scopes.includes("read")}
                  onChange={() => toggleScope("read")}
                />
                <span>
                  <strong>read</strong> — read sites, domains and deployments
                </span>
              </label>
              <label className={styles.check}>
                <input
                  type="checkbox"
                  checked={scopes.includes("write")}
                  onChange={() => toggleScope("write")}
                />
                <span>
                  <strong>write</strong> — create deployments and modify resources
                </span>
              </label>
            </fieldset>

            <label className={styles.label}>
              Expiration (optional)
              <input
                className={styles.input}
                type="date"
                value={expiresOn}
                onChange={(event) => setExpiresOn(event.target.value)}
                min={new Date().toISOString().slice(0, 10)}
              />
            </label>

            <button
              type="submit"
              className={`${styles.button} ${styles.primary}`}
              disabled={busy !== null || scopes.length === 0 || name.trim().length === 0}
            >
              {busy === "create" ? "Creating…" : "Create token"}
            </button>
          </form>
        </section>

        <section className={`${styles.panel} ${styles.listPanel}`} aria-label="Existing tokens">
          <h2 className={styles.panelTitle}>Workspace tokens</h2>
          {loading ? (
            <p className={styles.muted}>Loading tokens…</p>
          ) : tokens.length === 0 ? (
            <p className={styles.muted}>No tokens yet. Create one to use the CLI.</p>
          ) : (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Prefix</th>
                  <th scope="col">Scopes</th>
                  <th scope="col">Last used</th>
                  <th scope="col">Expires</th>
                  <th scope="col">Status</th>
                  <th scope="col" aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {tokens.map((token) => {
                  const state = tokenState(token);
                  return (
                    <tr key={token.id}>
                      <td>{token.name}</td>
                      <td className={styles.mono}>{token.prefix}…</td>
                      <td className={styles.mono}>{token.scopes.join(", ")}</td>
                      <td>{formatDate(token.lastUsedAt)}</td>
                      <td>{formatDate(token.expiresAt)}</td>
                      <td>
                        <span className={`${styles.badge} ${state.tone}`}>{state.label}</span>
                      </td>
                      <td className={styles.actions}>
                        {!token.revokedAt && (
                          <button
                            type="button"
                            className={`${styles.button} ${styles.danger}`}
                            onClick={() => revokeToken(token)}
                            disabled={busy !== null}
                          >
                            {busy === token.id ? "Revoking…" : "Revoke"}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </div>
  );
}
