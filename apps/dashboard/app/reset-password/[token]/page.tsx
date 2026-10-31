"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import styles from "../../login/page.module.css";
import { api } from "@/lib/api-client";
import { ApiError } from "@/lib/api-error";
import { useI18n } from "@/lib/i18n";

export default function ResetPasswordPage() {
  const params = useParams<{ token: string }>();
  const { t } = useI18n();
  const token = params.token;
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError(t("reset.error.short"));
      return;
    }
    if (password !== confirmation) {
      setError(t("reset.error.mismatch"));
      return;
    }

    setSubmitting(true);
    try {
      await api.confirmPasswordReset(token, password);
      setDone(true);
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === "INVALID_RESET_TOKEN"
          ? t("reset.error.invalidLink")
          : t("reset.error.generic")
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <p className={styles.eyebrow}>SiteDock</p>
        <h1 className={styles.title}>{t("reset.title")}</h1>
        <p className={styles.subtitle}>{t("reset.subtitle")}</p>

        {done ? (
          <>
            <p className={styles.success}>{t("reset.done")}</p>
            <p className={styles.helper}>
              <Link className={styles.link} href="/login">
                {t("reset.toLogin")}
              </Link>
            </p>
          </>
        ) : (
          <form className={styles.form} onSubmit={handleSubmit}>
            <label className={styles.field}>
              <span>{t("reset.title")}</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                minLength={8}
                required
              />
            </label>
            <label className={styles.field}>
              <span>{t("reset.confirm")}</span>
              <input
                type="password"
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
                autoComplete="new-password"
                minLength={8}
                required
              />
            </label>

            {error && <p className={styles.error}>{error}</p>}

            <button className={styles.submit} type="submit" disabled={submitting}>
              {submitting ? t("reset.submitting") : t("reset.submit")}
            </button>
            <p className={styles.helper}>
              <Link className={styles.link} href="/forgot-password">
                {t("reset.requestAnother")}
              </Link>
            </p>
          </form>
        )}
      </div>
    </main>
  );
}
