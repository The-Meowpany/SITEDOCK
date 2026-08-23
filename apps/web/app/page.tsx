"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./page.module.css";
import { api, type WebsiteDetail, type WorkspaceSummary } from "@/lib/api-client";

interface Option {
  workspace: WorkspaceSummary;
  website: WebsiteDetail;
}

const CHIP_LABEL: Record<WebsiteDetail["status"], string> = {
  LIVE: "En línea",
  PAST_DUE: "Pago pendiente",
  GRACE_PERIOD: "Gracia",
  SUSPENDED: "Suspendido",
  DRAFT: "En preparación",
  PREVIEW: "Vista previa",
  PENDING_APPROVAL: "Por aprobar",
  APPROVED: "Aprobado",
  ARCHIVED: "Archivado",
  DELETED: "Eliminado",
};

const CHIP_TONE: Partial<Record<WebsiteDetail["status"], string>> = {
  LIVE: styles.live,
  PAST_DUE: styles.pastDue,
  GRACE_PERIOD: styles.gracePeriod,
  SUSPENDED: styles.suspended,
};

export default function HomePage() {
  const router = useRouter();
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
        <p className={styles.loading}>Cargando…</p>
      </main>
    );
  }

  if (state === "empty") {
    return (
      <main className={styles.center}>
        <div className={styles.emptyCard}>
          <p className={styles.eyebrow}>SiteDock</p>
          <h1 className={styles.emptyTitle}>Todavía no hay sitios para mostrar</h1>
          <p className={styles.emptyBody}>
            Cuando tu desarrollador te invite a un workspace con un sitio, vas a verlo acá.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className={styles.center}>
      <div className={styles.pickerCard}>
        <p className={styles.eyebrow}>SiteDock</p>
        <h1 className={styles.emptyTitle}>Elegí un sitio</h1>
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
                  {CHIP_LABEL[website.status]}
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
            Cerrar sesión
          </button>
        </div>
      </div>
    </main>
  );
}

