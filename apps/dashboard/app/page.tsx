"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import styles from "./page.module.css";

/**
 * Entry point: resolve the developer's workspaces and jump into the first
 * workspace where they have a staff role. The console is workspace-scoped —
 * there is nothing to show before a workspace is chosen.
 */
export default function HomePage() {
  const router = useRouter();
  const { t } = useI18n();
  const tRef = useRef(t);
  tRef.current = t;
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function route() {
      try {
        const workspaces = await api.listWorkspaces();
        if (cancelled) return;
        const staff = workspaces.filter((w) => w.role !== "CLIENT");
        if (staff.length === 0) {
          setError(tRef.current("home.noWorkspace"));
          return;
        }
        router.replace(`/workspaces/${staff[0]!.id}`);
      } catch {
        if (!cancelled) router.replace("/login?returnTo=/");
      }
    }

    route();
    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <main className={styles.page}>
      <p className={styles.hint}>{error ?? t("home.opening")}</p>
    </main>
  );
}
