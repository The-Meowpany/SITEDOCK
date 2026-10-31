"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./page.module.css";
import { api, type WebsiteDetail, type WorkspaceSummary } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";

interface Option {
  workspace: WorkspaceSummary;
  website: WebsiteDetail;
}

const CHIP_TONE: Partial<Record<WebsiteDetail["status"], string>> = {
  LIVE: styles.live,
  PAST_DUE: styles.pastDue,
  GRACE_PERIOD: styles.gracePeriod,
  SUSPENDED: styles.suspended,
};

export default function HomePage() {
  const router = useRouter();
  const { t } = useI18n();
  const [state, setState] = useState<"loading" | "picking" | "empty">("loading");
  const [options, setOptions] = useState<Option[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function resolve() {
      try {
        await api.me();
      } catch {
        router.replace("/login");
        return;
      }

      const workspaces = await api.listWorkspaces();
      // Parallel: a client with several workspaces previously waited on one
      // sequential request chain per workspace (request waterfall).
      const found: Option[] = (await Promise.all(
        workspaces.map(async (workspace) => {
          const websites = await api.listWebsites(workspace.id).catch(() => []);
          return websites.map((website) => ({ workspace, website }));
        })
      )).flat();

      if (cancelled) return;

      if (found.length === 1) {
        router.replace(`/portal/${found[0].workspace.id}/${found[0].website.id}`);
        return;
      }

      if (found.length === 0) {
        setState("empty");
        return;
      }

      setOptions(found);
      setState("picking");
    }

    resolve().catch(() => setState("empty"));
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (state === "loading") {
    return (
      <main className={styles.center}>
        <p className={styles.loading}>{t("home.loading")}</p>
      </main>
    );
  }

  if (state === "empty") {
    return (
      <main className={styles.center}>
        <div className={styles.emptyCard}>
          <p className={styles.eyebrow}>SiteDock</p>
          <h1 className={styles.emptyTitle}>{t("home.empty.title")}</h1>
          <p className={styles.emptyBody}>
            {t("home.empty.body")}
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className={styles.center}>
      <div className={styles.pickerCard}>
        <p className={styles.eyebrow}>SiteDock</p>
        <h1 className={styles.emptyTitle}>{t("home.pick")}</h1>
        <ul className={styles.pickerList}>
          {options.map(({ workspace, website }) => (
            <li key={website.id}>
              <button
                className={styles.pickerItem}
                onClick={() => router.push(`/portal/${workspace.id}/${website.id}`)}
              >
                <span className={styles.pickerText}>
                  <span className={styles.pickerName}>{website.name}</span>
                  <span className={styles.pickerMeta}>{workspace.name}</span>
                </span>
                <span className={`${styles.chip} ${CHIP_TONE[website.status] ?? ""}`}>
                  <span className={styles.dot} aria-hidden />
                  {t(`chip.${website.status}`)}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <div className={styles.logoutLink}>
          <button
            className={styles.logoutButton}
            onClick={async () => {
              await api.logout().catch(() => {});
              router.replace("/login");
            }}
          >
            {t("home.logout")}
          </button>
        </div>
      </div>
    </main>
  );
}

