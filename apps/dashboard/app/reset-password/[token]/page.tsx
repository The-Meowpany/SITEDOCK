"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import styles from "../../login/page.module.css";
import { api } from "@/lib/api-client";
import { ApiError } from "@/lib/api-error";

export default function ResetPasswordPage() {
  const params = useParams<{ token: string }>();
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
      setError("La contraseña debe tener al menos 8 caracteres.");
      return;
    }
    if (password !== confirmation) {
      setError("Las contraseñas no coinciden.");
      return;
    }

    setSubmitting(true);
    try {
      await api.confirmPasswordReset(token, password);
      setDone(true);
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === "INVALID_RESET_TOKEN"
          ? "El enlace es inválido o expiró. Solicita uno nuevo."
          : "No pudimos restablecer la contraseña. Inténtalo de nuevo."
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <p className={styles.eyebrow}>SiteDock</p>
        <h1 className={styles.title}>Nueva contraseña</h1>
        <p className={styles.subtitle}>Define la contraseña de tu cuenta.</p>

        {done ? (
          <>
            <p className={styles.success}>Contraseña actualizada. Ya puedes ingresar.</p>
            <p className={styles.helper}>
              <Link className={styles.link} href="/login">
                Ir al login
              </Link>
            </p>
          </>
        ) : (
          <form className={styles.form} onSubmit={handleSubmit}>
            <label className={styles.field}>
              <span>Nueva contraseña</span>
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
              <span>Confirmar contraseña</span>
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
              {submitting ? "Guardando…" : "Guardar contraseña"}
            </button>
            <p className={styles.helper}>
              <Link className={styles.link} href="/forgot-password">
                Solicitar otro enlace
              </Link>
            </p>
          </form>
        )}
      </div>
    </main>
  );
}
