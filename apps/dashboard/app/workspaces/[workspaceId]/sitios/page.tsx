"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/lib/api-client";
import type { ProjectSummary, WebsiteSummary } from "@/lib/api-client";
import { ApiError } from "@/lib/api-error";
import { Field, btnGhost, btnPrimary, formRow, inputClass, selectClass } from "@/components/ui";
import { OnboardingChecklist, StatusChip } from "@/components/StatusChip";
import { useI18n } from "@/lib/i18n";
import { siteHostname } from "@/lib/site-domain";
import styles from "./page.module.css";

type CreationMode = "existing-project" | "new-project";

export default function SitesPage() {
  const params = useParams<{ workspaceId: string }>();
  const router = useRouter();
  const { t } = useI18n();
  const tRef = useRef(t);
  tRef.current = t;
  const workspaceId = params.workspaceId;

  const [sites, setSites] = useState<WebsiteSummary[] | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Create-form state
  const [mode, setMode] = useState<CreationMode>("new-project");
  const [projectId, setProjectId] = useState<string>("");
  const [newProjectName, setNewProjectName] = useState("");
  const [siteName, setSiteName] = useState("");
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => {
    Promise.all([api.listWebsites(workspaceId), api.listProjects(workspaceId)])
      .then(([w, p]) => {
        setSites(w);
        setProjects(p);
        if (p.length > 0 && !projectId) {
          setMode("existing-project");
          setProjectId(p[0]!.id);
        }
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) {
          router.replace(`/login?returnTo=/workspaces/${workspaceId}/sitios`);
          return;
        }
      setError(err instanceof Error ? err.message : tRef.current("sites.loadError"));
      });
  }, [workspaceId, router]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const name = siteName.trim();
    if (name.length < 2) {
      setError(t("sites.nameShort"));
      return;
    }

    setCreating(true);
    try {
      let targetProjectId = projectId;
      if (mode === "new-project") {
        const projectName = newProjectName.trim();
        if (projectName.length < 2) {
          throw new Error(t("sites.projectNameShort"));
        }
        const created = await api.createProject(workspaceId, projectName);
        targetProjectId = created.projectId;
      }
      if (!targetProjectId) throw new Error(t("sites.pickProject"));

      const result = await api.createWebsite(workspaceId, targetProjectId, name);
      router.push(`/workspaces/${workspaceId}/sitios/${result.websiteId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("sites.createError"));
    } finally {
      setCreating(false);
    }
  }

  const loading = sites === null;

  return (
    <>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>{t("sites.eyebrow")}</p>
          <h1 className={styles.title}>{t("nav.sites")}</h1>
        </div>
      </header>

      {error && <p className={styles.error}>{error}</p>}

      <section className={styles.panel} aria-label={t("sites.create.aria")}>
        <h2 className={styles.panelTitle}>{t("sites.create.title")}</h2>
        <form className={styles.form} onSubmit={handleCreate}>
          <div className={formRow}>
            <Field label={t("sites.project")}>
              <div className={formRow}>
                <select
                  className={selectClass}
                  value={mode}
                  onChange={(e) => setMode(e.target.value as CreationMode)}
                  aria-label={t("sites.projectModeAria")}
                >
                  <option value="new-project">{t("sites.newProject")}</option>
                  {projects.length > 0 && <option value="existing-project">{t("client.existing")}</option>}
                </select>
                {mode === "new-project" ? (
                  <input
                    className={inputClass}
                    placeholder={t("sites.projectPlaceholder")}
                    value={newProjectName}
                    onChange={(e) => setNewProjectName(e.target.value)}
                  />
                ) : (
                  <select
                    className={selectClass}
                    value={projectId}
                    onChange={(e) => setProjectId(e.target.value)}
                    aria-label={t("sites.existingProjectAria")}
                  >
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </Field>

            <Field label={t("sites.siteName")}>
              <input
                className={inputClass}
                placeholder={t("sites.sitePlaceholder")}
                value={siteName}
                onChange={(e) => setSiteName(e.target.value)}
              />
            </Field>

            <button className={creating ? btnGhost : btnPrimary} type="submit" disabled={creating}>
              {creating ? t("sites.creating") : t("sites.createButton")}
            </button>
          </div>
        </form>
      </section>

      <section className={styles.panel} aria-label={t("sites.list.aria")}>
        <h2 className={styles.panelTitle}>{t("sites.list.title")}</h2>
        {loading ? (
          <p className={styles.empty}>{t("sites.loading")}</p>
        ) : sites!.length === 0 ? (
          <>
            <p className={styles.empty}>
              {t("sites.empty")}
            </p>
            <OnboardingChecklist />
          </>
        ) : (
          <ul className={styles.grid}>
            {sites.map((site) => (
              <li key={site.id}>
                <Link href={`/workspaces/${workspaceId}/sitios/${site.id}`} className={styles.siteCard}>
                  <span className={styles.siteName}>{site.name}</span>
                  <span className={styles.siteSubdomain}>{siteHostname(site.subdomain)}</span>
                  <StatusChip status={site.status} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
