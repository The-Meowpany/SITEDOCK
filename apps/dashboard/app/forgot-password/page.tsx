"use client";

import Link from "next/link";
import { useState } from "react";
import styles from "../login/page.module.css";
import { api } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";

export default function ForgotPasswordPage() {
  const { t } = useI18n();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.requestPasswordReset(email);
      setSent(true);
    } catch {
      setError(t("forgot.error"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <p className={styles.eyebrow}>SiteDock</p>
        <h1 className={styles.title}>{t("forgot.title")}</h1>
        <p className={styles.subtitle}>
          {t("forgot.intro")}
        </p>

        {sent ? (
          <>
            <p className={styles.success}>
              {t("forgot.sent")}
            </p>
            <p className={styles.helper}>
              <Link className={styles.link} href="/login">
                {t("auth.backToLogin")}
              </Link>
            </p>
          </>
        ) : (
          <form className={styles.form} onSubmit={handleSubmit}>
            <label className={styles.field}>
              <span>{t("auth.email")}</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
              />
            </label>

            {error && <p className={styles.error}>{error}</p>}

            <button className={styles.submit} type="submit" disabled={submitting}>
              {submitting ? t("forgot.submitting") : t("forgot.submit")}
            </button>
            <p className={styles.helper}>
              <Link className={styles.link} href="/login">
                {t("auth.backToLogin")}
              </Link>
            </p>
          </form>
        )}
      </div>
    </main>
  );
}
