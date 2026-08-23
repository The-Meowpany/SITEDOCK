"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import styles from "../../page.module.css";
import { api, ApiError } from "@/lib/api-client";

export default function AcceptInvitePage() {
  const params = useParams<{ token: string }>();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      try {
        await api.me();
      } catch {
        router.replace(`/login?returnTo=${encodeURIComponent(`/invite/${params.token}`)}`);
        return;
      }

      try {
        await api.acceptInvitation(params.token);
        if (!cancelled) router.replace("/");
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.code === "INVITATION_EMAIL_MISMATCH") {
          setError("Esta invitación fue enviada a otro email. Iniciá sesión con la cuenta correcta.");
        } else if (err instanceof ApiError && err.code === "INVITATION_EXPIRED") {
          setError("Esta invitación ya venció. Pedile a tu desarrollador que te envíe una nueva.");
        } else {
          setError("No pudimos procesar la invitación.");
        }
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [params.token, router]);

  return (
    <main className={styles.center}>
      {error ? <p className={styles.error}>{error}</p> : <p className={styles.loading}>Aceptando invitación…</p>}
    </main>
  );
}
