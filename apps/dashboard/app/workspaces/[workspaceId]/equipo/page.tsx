"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/lib/api-client";
import type { MemberRole, MemberSummary } from "@/lib/api-client";
import { ApiError } from "@/lib/api-error";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n";
import { assignableRoles, canManage } from "@/lib/team-roles";
import styles from "./page.module.css";

type Role = MemberSummary["role"];

export default function TeamPage() {
  const params = useParams<{ workspaceId: string }>();
  const router = useRouter();
  const workspaceId = params.workspaceId;
  const { t } = useI18n();
  // Always-current translator for async callbacks (keeps data loading independent of locale changes).
  const tRef = useRef(t);
  tRef.current = t;

  const [members, setMembers] = useState<MemberSummary[]>([]);
  const [meId, setMeId] = useState<string | null>(null);
  const [myRole, setMyRole] = useState<Role | null>(null);
  const [workspaceName, setWorkspaceName] = useState("");
  const [nameDraft, setNameDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [newOwner, setNewOwner] = useState("");
  const [transferPassword, setTransferPassword] = useState("");
  const [deleteName, setDeleteName] = useState("");
  const [deletePassword, setDeletePassword] = useState("");

  const handleFailure = useCallback(
    (err: unknown, fallback: MessageKey) => {
      if (err instanceof ApiError && err.status === 401 && err.code === "UNAUTHORIZED") {
        router.replace(`/login?returnTo=/workspaces/${workspaceId}/equipo`);
        return;
      }
      if (err instanceof ApiError && err.status === 403 && err.code === "FORBIDDEN") {
        setError(err.message || tRef.current("common.permissionDenied"));
        return;
      }
      setError(err instanceof Error && err.message ? err.message : tRef.current(fallback));
    },
    [router, workspaceId]
  );

  const load = useCallback(async () => {
    const [me, workspaces] = await Promise.all([api.me(), api.listWorkspaces()]);
    const current = workspaces.find((w) => w.id === workspaceId);
    setMeId(me.id);
    setMyRole(current?.role ?? null);
    setWorkspaceName(current?.name ?? "");
    setNameDraft(current?.name ?? "");
    // Clients cannot list teammates (the API returns 403); everyone else sees the roster.
    if (current && current.role !== "CLIENT") {
      setMembers(await api.listMembers(workspaceId));
    } else {
      setMembers([]);
    }
  }, [workspaceId]);

  useEffect(() => {
    let cancelled = false;
    load()
      .catch((err) => !cancelled && handleFailure(err, "team.loadError"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [load, handleFailure]);

  async function run(key: string, action: () => Promise<void>, fallback: MessageKey) {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (err) {
      handleFailure(err, fallback);
    } finally {
      setBusy(null);
    }
  }

  const rename = (event: React.FormEvent) => {
    event.preventDefault();
    return run(
      "rename",
      async () => {
        const result = await api.renameWorkspace(workspaceId, nameDraft.trim());
        setWorkspaceName(result.name);
        setNameDraft(result.name);
        setNotice(tRef.current("name.done"));
      },
      "name.error"
    );
  };

  const changeRole = (member: MemberSummary, role: MemberRole) =>
    run(
      member.userId,
      async () => {
        await api.changeMemberRole(workspaceId, member.userId, role);
        setNotice(tRef.current("members.roleUpdated", { name: member.fullName ?? member.email ?? tRef.current("members.fallbackName") }));
        await load();
      },
      "members.roleError"
    );

  const remove = (member: MemberSummary) => {
    const self = member.userId === meId;
    const label = member.fullName ?? member.email ?? t("members.thisMember");
    const question = self ? t("members.confirmLeave") : t("members.confirmRemove", { name: label });
    if (!window.confirm(question)) return Promise.resolve();
    return run(
      member.userId,
      async () => {
        await api.removeMember(workspaceId, member.userId);
        if (self) {
          router.replace("/");
          return;
        }
        setNotice(tRef.current("members.removed", { name: label }));
        await load();
      },
      "members.removeError"
    );
  };

  const transfer = (event: React.FormEvent) => {
    event.preventDefault();
    return run(
      "transfer",
      async () => {
        await api.transferOwnership(workspaceId, newOwner, transferPassword);
        setTransferPassword("");
        setNewOwner("");
        setNotice(tRef.current("transfer.done"));
        await load();
      },
      "transfer.error"
    );
  };

  const destroy = (event: React.FormEvent) => {
    event.preventDefault();
    return run(
      "delete",
      async () => {
        await api.deleteWorkspace(workspaceId, deleteName, deletePassword);
        router.replace("/");
      },
      "destroy.error"
    );
  };

  const canRename = myRole === "OWNER" || myRole === "ADMIN";
  const transferCandidates = members.filter((m) => m.role === "ADMIN" || m.role === "DEVELOPER");

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <p className={styles.eyebrow}>{t("team.eyebrow")}</p>
        <h1 className={styles.title}>{t("team.title")}</h1>
      </header>
      <p className={styles.intro}>{t("team.intro", { name: workspaceName || t("team.thisWorkspace") })}</p>

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      )}

      {loading ? (
        <p className={styles.muted}>{t("team.loading")}</p>
      ) : (
        <div className={styles.stack}>
          {canRename && (
            <section className={styles.panel} aria-label={t("name.title")}>
              <h2 className={styles.panelTitle}>{t("name.title")}</h2>
              <form className={styles.form} onSubmit={rename}>
                <label className={styles.label}>
                  {t("name.label")}
                  <input className={styles.input} value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} minLength={2} maxLength={120} required />
                </label>
                <button type="submit" className={`${styles.button} ${styles.primary}`} disabled={busy !== null || nameDraft.trim().length < 2 || nameDraft.trim() === workspaceName}>
                  {busy === "rename" ? t("name.saving") : t("name.submit")}
                </button>
              </form>
            </section>
          )}

          <section className={`${styles.panel} ${styles.listPanel}`} aria-label={t("members.title")}>
            <h2 className={styles.panelTitle}>{t("members.title")}</h2>
            {myRole === "CLIENT" ? (
              <p className={styles.muted}>{t("members.clientsBlocked")}</p>
            ) : members.length === 0 ? (
              <p className={styles.muted}>{t("members.empty")}</p>
            ) : (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col">{t("members.name")}</th>
                    <th scope="col">{t("members.email")}</th>
                    <th scope="col">{t("members.role")}</th>
                    <th scope="col" aria-label={t("members.actions")} />
                  </tr>
                </thead>
                <tbody>
                  {members.map((member) => {
                    const self = member.userId === meId;
                    const editable = !self && canManage(myRole, member.role);
                    const canLeave = self && member.role !== "OWNER";
                    return (
                      <tr key={member.userId}>
                        <td>
                          {member.fullName ?? "—"}
                          {self && <span className={`${styles.badge} ${styles.active}`}> {t("members.you")}</span>}
                        </td>
                        <td>{member.email ?? "—"}</td>
                        <td>
                          {editable ? (
                            <select
                              className={styles.select}
                              aria-label={t("members.roleOf", { name: member.fullName ?? member.email ?? t("members.fallbackName") })}
                              value={member.role}
                              disabled={busy !== null}
                              onChange={(e) => changeRole(member, e.target.value as MemberRole)}
                            >
                              {assignableRoles(myRole).map((role) => (
                                <option key={role} value={role}>
                                  {t(`role.${role}`)}
                                </option>
                              ))}
                            </select>
                          ) : (
                            t(`role.${member.role}`)
                          )}
                        </td>
                        <td className={styles.actions}>
                          {(editable || canLeave) && (
                            <button type="button" className={`${styles.button} ${styles.danger}`} onClick={() => remove(member)} disabled={busy !== null}>
                              {busy === member.userId ? "…" : self ? t("members.leave") : t("members.remove")}
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

          {myRole === "OWNER" && (
            <>
              <section className={styles.panel} aria-label={t("transfer.title")}>
                <h2 className={styles.panelTitle}>{t("transfer.title")}</h2>
                <p className={styles.hint}>
                  {t("transfer.hint")}
                </p>
                <form className={styles.form} onSubmit={transfer}>
                  <label className={styles.label}>
                    {t("transfer.label")}
                    <select className={styles.select} value={newOwner} onChange={(e) => setNewOwner(e.target.value)} required>
                      <option value="">{t("transfer.placeholder")}</option>
                      {transferCandidates.map((m) => (
                        <option key={m.userId} value={m.userId}>
                          {m.fullName ?? m.email} ({t(`role.${m.role}`)})
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className={styles.label}>
                    {t("transfer.password")}
                    <input className={styles.input} type="password" autoComplete="current-password" value={transferPassword} onChange={(e) => setTransferPassword(e.target.value)} required />
                  </label>
                  <button type="submit" className={`${styles.button} ${styles.danger}`} disabled={busy !== null || !newOwner || transferPassword.length === 0}>
                    {busy === "transfer" ? t("transfer.submitting") : t("transfer.submit")}
                  </button>
                </form>
              </section>

              <section className={`${styles.panel} ${styles.dangerZone}`} aria-label={t("destroy.title")}>
                <h2 className={styles.panelTitle}>{t("destroy.title")}</h2>
                <p className={styles.hint}>
                  {t("destroy.hint")}
                </p>
                <form className={styles.form} onSubmit={destroy}>
                  <label className={styles.label}>
                    {t("destroy.nameLabel", { name: workspaceName })}
                    <input className={styles.input} value={deleteName} onChange={(e) => setDeleteName(e.target.value)} autoComplete="off" required />
                  </label>
                  <label className={styles.label}>
                    {t("transfer.password")}
                    <input className={styles.input} type="password" autoComplete="current-password" value={deletePassword} onChange={(e) => setDeletePassword(e.target.value)} required />
                  </label>
                  <button type="submit" className={`${styles.button} ${styles.danger}`} disabled={busy !== null || deleteName !== workspaceName || deletePassword.length === 0}>
                    {busy === "delete" ? t("destroy.submitting") : t("destroy.submit")}
                  </button>
                </form>
              </section>
            </>
          )}
        </div>
      )}
    </div>
  );
}
