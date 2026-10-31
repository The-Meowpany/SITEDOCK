"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import styles from "../../page.module.css";
import { api, ApiError } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";

export default function AcceptInvitePage() {
  const params = useParams<{ token: string }>();
  const router = useRouter();
  const { t } = useI18n();
  const tRef = useRef(t);
  tRef.current = t;
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
          setError(tRef.current("invite.mismatch"));
        } else if (err instanceof ApiError && err.code === "INVITATION_EXPIRED") {
          setError(tRef.current("invite.expired"));
        } else {
          setError(tRef.current("invite.error"));
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
      {error ? <p className={styles.error}>{error}</p> : <p className={styles.loading}>{t("invite.accepting")}</p>}
    </main>
  );
}
