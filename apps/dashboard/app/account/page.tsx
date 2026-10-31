"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { api } from "@/lib/api-client";
import type { SessionInfo } from "@/lib/api-client";
import { ApiError } from "@/lib/api-error";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n";
import styles from "./page.module.css";

export default function AccountPage() {
  const router = useRouter();
  const { t, formatDateTime } = useI18n();

  // Always-current translator for async callbacks, so a late locale switch does not
  // re-trigger data loading just because `t` changed identity.
  const tRef = useRef(t);
  tRef.current = t;

  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [emailPassword, setEmailPassword] = useState("");
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState("");

  const handleFailure = useCallback(
    (err: unknown, fallback: MessageKey) => {
      // Only an actual expired session sends the user to the login page: a wrong password
      // is a 400 and must never look like a logout.
      if (err instanceof ApiError && err.status === 401 && err.code === "UNAUTHORIZED") {
        router.replace("/login?returnTo=/account");
        return;
      }
      setError(err instanceof Error && err.message ? err.message : tRef.current(fallback));
    },
    [router]
  );

  const load = useCallback(async () => {
    const [me, list] = await Promise.all([api.me(), api.listSessions()]);
    setEmail(me.email);
    setFullName(me.fullName);
    setSessions(list);
  }, []);

  useEffect(() => {
    let cancelled = false;
    load()
      .catch((err) => !cancelled && handleFailure(err, "account.loadError"))
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

  const saveProfile = (event: React.FormEvent) => {
    event.preventDefault();
    return run(
      "profile",
      async () => {
        const result = await api.updateProfile(fullName.trim());
        setFullName(result.fullName);
        setNotice(tRef.current("profile.updated"));
      },
      "profile.error"
    );
  };

  const savePassword = (event: React.FormEvent) => {
    event.preventDefault();
    return run(
      "password",
      async () => {
        const { revokedSessions } = await api.changePassword(currentPassword, newPassword);
        setCurrentPassword("");
        setNewPassword("");
        setNotice(
          revokedSessions > 0
            ? tRef.current("password.doneRevoked", { count: revokedSessions })
            : tRef.current("password.done")
        );
        await load();
      },
      "password.error"
    );
  };

  const saveEmail = (event: React.FormEvent) => {
    event.preventDefault();
    return run(
      "email",
      async () => {
        const result = await api.changeEmail(newEmail.trim(), emailPassword);
        setEmail(result.email);
        setNewEmail("");
        setEmailPassword("");
        setNotice(tRef.current("email.done"));
        await load();
      },
      "email.error"
    );
  };

  const revokeOne = (session: SessionInfo) =>
    run(
      session.id,
      async () => {
        await api.revokeSession(session.id);
        setSessions((current) => current.filter((s) => s.id !== session.id));
      },
      "sessions.closeError"
    );

  const revokeOthers = () =>
    run(
      "others",
      async () => {
        const { revoked } = await api.revokeOtherSessions();
        setNotice(tRef.current("sessions.closedOthers", { count: revoked }));
        await load();
      },
      "sessions.closeOthersError"
    );

  const removeAccount = (event: React.FormEvent) => {
    event.preventDefault();
    return run(
      "delete",
      async () => {
        await api.deleteAccount(deletePassword);
        router.replace("/login");
      },
      "delete.error"
    );
  };

  const otherSessions = sessions.filter((s) => !s.current).length;
  const confirmWord = t("delete.word");

  return (
    <>
      <AppHeader subtitle={t("header.subtitle.account")} />
      <div className={styles.page}>
        <header className={styles.header}>
          <p className={styles.eyebrow}>{t("account.eyebrow")}</p>
          <h1 className={styles.title}>{t("account.title")}</h1>
        </header>
        <p className={styles.intro}>
          {t("account.intro", { email: email || t("account.introFallback") })}{" "}
          <Link href="/">{t("account.back")}</Link>
        </p>

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
          <p className={styles.muted}>{t("account.loading")}</p>
        ) : (
          <div className={styles.stack}>
            <section className={styles.panel} aria-label={t("profile.title")}>
              <h2 className={styles.panelTitle}>{t("profile.title")}</h2>
              <form className={styles.form} onSubmit={saveProfile}>
                <label className={styles.label}>
                  {t("profile.fullName")}
                  <input className={styles.input} value={fullName} onChange={(e) => setFullName(e.target.value)} minLength={2} maxLength={120} required />
                </label>
                <button type="submit" className={`${styles.button} ${styles.primary}`} disabled={busy !== null || fullName.trim().length < 2}>
                  {busy === "profile" ? t("profile.saving") : t("profile.save")}
                </button>
              </form>
            </section>

            <section className={styles.panel} aria-label={t("password.title")}>
              <h2 className={styles.panelTitle}>{t("password.title")}</h2>
              <form className={styles.form} onSubmit={savePassword}>
                <label className={styles.label}>
                  {t("password.current")}
                  <input className={styles.input} type="password" autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required />
                </label>
                <label className={styles.label}>
                  {t("password.new")}
                  <input className={styles.input} type="password" autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} minLength={8} required />
                </label>
                <button type="submit" className={`${styles.button} ${styles.primary}`} disabled={busy !== null || newPassword.length < 8 || currentPassword.length === 0}>
                  {busy === "password" ? t("password.submitting") : t("password.submit")}
                </button>
              </form>
            </section>

            <section className={styles.panel} aria-label={t("email.title")}>
              <h2 className={styles.panelTitle}>{t("email.title")}</h2>
              <p className={styles.hint}>{t("email.hint")}</p>
              <form className={styles.form} onSubmit={saveEmail}>
                <label className={styles.label}>
                  {t("email.new")}
                  <input className={styles.input} type="email" autoComplete="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} required />
                </label>
                <label className={styles.label}>
                  {t("password.current")}
                  <input className={styles.input} type="password" autoComplete="current-password" value={emailPassword} onChange={(e) => setEmailPassword(e.target.value)} required />
                </label>
                <button type="submit" className={`${styles.button} ${styles.primary}`} disabled={busy !== null || newEmail.trim().length === 0 || emailPassword.length === 0}>
                  {busy === "email" ? t("email.submitting") : t("email.submit")}
                </button>
              </form>
            </section>

            <section className={`${styles.panel} ${styles.listPanel}`} aria-label={t("sessions.title")}>
              <h2 className={styles.panelTitle}>{t("sessions.title")}</h2>
              {sessions.length === 0 ? (
                <p className={styles.muted}>{t("sessions.empty")}</p>
              ) : (
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th scope="col">{t("sessions.device")}</th>
                      <th scope="col">{t("sessions.ip")}</th>
                      <th scope="col">{t("sessions.started")}</th>
                      <th scope="col">{t("sessions.expires")}</th>
                      <th scope="col" aria-label={t("sessions.actions")} />
                    </tr>
                  </thead>
                  <tbody>
                    {sessions.map((session) => (
                      <tr key={session.id}>
                        <td>
                          {session.userAgent ?? t("sessions.unknownDevice")}
                          {session.current && <span className={`${styles.badge} ${styles.active}`}> {t("sessions.current")}</span>}
                        </td>
                        <td className={styles.mono}>{session.ipAddress ?? "—"}</td>
                        <td>{formatDateTime(session.createdAt)}</td>
                        <td>{formatDateTime(session.expiresAt)}</td>
                        <td className={styles.actions}>
                          {!session.current && (
                            <button type="button" className={`${styles.button} ${styles.danger}`} onClick={() => revokeOne(session)} disabled={busy !== null}>
                              {busy === session.id ? t("sessions.closing") : t("sessions.close")}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {otherSessions > 0 && (
                <p>
                  <button type="button" className={`${styles.button} ${styles.danger}`} onClick={revokeOthers} disabled={busy !== null}>
                    {busy === "others" ? t("sessions.closing") : t("sessions.closeOthers")}
                  </button>
                </p>
              )}
            </section>

            <section className={`${styles.panel} ${styles.dangerZone}`} aria-label={t("delete.title")}>
              <h2 className={styles.panelTitle}>{t("delete.title")}</h2>
              <p className={styles.hint}>{t("delete.hint")}</p>
              <form className={styles.form} onSubmit={removeAccount}>
                <label className={styles.label}>
                  {t("delete.password")}
                  <input className={styles.input} type="password" autoComplete="current-password" value={deletePassword} onChange={(e) => setDeletePassword(e.target.value)} required />
                </label>
                <label className={styles.label}>
                  {t("delete.confirmLabel", { word: confirmWord })}
                  <input className={styles.input} value={deleteConfirm} onChange={(e) => setDeleteConfirm(e.target.value)} autoComplete="off" />
                </label>
                <button type="submit" className={`${styles.button} ${styles.danger}`} disabled={busy !== null || deleteConfirm !== confirmWord || deletePassword.length === 0}>
                  {busy === "delete" ? t("delete.submitting") : t("delete.submit")}
                </button>
              </form>
            </section>
          </div>
        )}
      </div>
    </>
  );
}
