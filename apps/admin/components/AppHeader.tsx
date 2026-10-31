"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./AppHeader.module.css";
import { api } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";

interface AppHeaderProps {
  /** Subtitle shown next to the brand, e.g. the workspace name. */
  subtitle: string;
}

/** Shared console header: brand mark, context subtitle and session controls. */
export function AppHeader({ subtitle }: AppHeaderProps) {
  const router = useRouter();
  const { t } = useI18n();
  const [email, setEmail] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    api
      .me()
      .then((me) => setEmail(me.email))
      .catch(() => setEmail(null));
  }, []);

  async function handleLogout() {
    setLeaving(true);
    try {
      await api.logout().catch(() => {});
    } finally {
      router.replace("/login");
    }
  }

  return (
    <header className={styles.header}>
      <div className={styles.brand}>
        <span className={styles.mark} aria-hidden>
          S
        </span>
        <div>
          <p className={styles.eyebrow}>{t("header.eyebrow")}</p>
          <p className={styles.subtitle}>{subtitle}</p>
        </div>
      </div>
      <div className={styles.session}>
        {email && <span className={styles.email}>{email}</span>}
        <button className={styles.logout} onClick={handleLogout} disabled={leaving}>
          {leaving ? t("header.leaving") : t("header.logout")}
        </button>
      </div>
    </header>
  );
}

