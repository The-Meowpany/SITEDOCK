"use client";

import Link from "next/link";
import { useState } from "react";
import styles from "../login/page.module.css";
import { api } from "@/lib/api-client";

export default function ForgotPasswordPage() {
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
      setError("No pudimos enviar el enlace. Inténtalo de nuevo.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <p className={styles.eyebrow}>SiteDock</p>
        <h1 className={styles.title}>Recuperar acceso</h1>
        <p className={styles.subtitle}>
          Te enviaremos un enlace para restablecer tu contraseña.
        </p>

        {sent ? (
          <>
            <p className={styles.success}>
              Si el email existe, enviamos un enlace de recuperación. Revisa tu bandeja.
            </p>
            <p className={styles.helper}>
              <Link className={styles.link} href="/login">
                Volver al login
              </Link>
            </p>
          </>
        ) : (
          <form className={styles.form} onSubmit={handleSubmit}>
            <label className={styles.field}>
              <span>Email</span>
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
              {submitting ? "Enviando…" : "Enviar enlace"}
            </button>
            <p className={styles.helper}>
              <Link className={styles.link} href="/login">
                Volver al login
              </Link>
            </p>
          </form>
        )}
      </div>
    </main>
  );
}
