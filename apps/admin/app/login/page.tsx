"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./page.module.css";
import { api } from "@/lib/api-client";
import { ApiError } from "@/lib/api-error";

function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.login(email, password);
      // Only PLATFORM_ADMINs get past the API's requirePlatformAdmin gate —
      // verify before showing the console so non-admins get a clear message.
      const me = await api.me();
      if (me.platformRole !== "PLATFORM_ADMIN") {
        setError("Esta cuenta no es administradora de plataforma.");
        return;
      }
      router.push("/");
    } catch (err) {
      setError(err instanceof ApiError ? "Email o contraseña incorrectos." : "No pudimos conectar con SiteDock.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <label className={styles.field}>
        <span>Email</span>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
      </label>
      <label className={styles.field}>
        <span>Contraseña</span>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />
      </label>

      {error && <p className={styles.error}>{error}</p>}

      <button className={styles.submit} type="submit" disabled={submitting}>
        {submitting ? "Ingresando…" : "Ingresar"}
      </button>
    </form>
  );
}

export default function LoginPage() {
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    // Already logged in as admin? Skip straight to the console.
    api
      .me()
      .then((me) => {
        if (me.platformRole === "PLATFORM_ADMIN") window.location.href = "/";
      })
      .catch(() => {})
      .finally(() => setChecking(false));
  }, []);

  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <p className={styles.eyebrow}>SiteDock · Plataforma</p>
        <h1 className={styles.title}>Administración</h1>
        <p className={styles.subtitle}>Acceso exclusivo para administradores de la plataforma.</p>

        {checking ? <p className={styles.subtitle}>Verificando sesión…</p> : (
          <Suspense fallback={null}>
            <LoginForm />
          </Suspense>
        )}
      </div>
    </main>
  );
}
