"use client";

import { useState } from "react";
import styles from "./MaintenancePanel.module.css";
import { api, type MaintenanceRequestSummary, type TierCoverage } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import type { MessageKey, TranslateParams } from "@/lib/i18n";

function coverageNote(tier: TierCoverage, t: (key: MessageKey, params?: TranslateParams) => string): string {
  if (!tier.hasMembership) return t("maint.noMembership");
  if (tier.covered) {
    const left =
      tier.remaining === null || tier.remaining === undefined
        ? t("maint.unlimited")
        : tier.remaining === 1
          ? t("maint.oneLeft")
          : t("maint.nLeft", { count: tier.remaining });
    return t("maint.covered", { plan: tier.planName ?? "", left });
  }
  return t("maint.overQuota");
}

export function MaintenancePanel({
  workspaceId,
  websiteId,
  initialRequests,
}: {
  workspaceId: string;
  websiteId: string;
  initialRequests: MaintenanceRequestSummary[];
}) {
  const { t } = useI18n();
  const [requests, setRequests] = useState(initialRequests);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [coverage, setCoverage] = useState<TierCoverage | null>(null);

  async function handleAction(action: "approve" | "changes", requestId: string) {
    setBusyId(requestId);
    setActionError(null);
    try {
      if (action === "approve") {
        await api.approveMaintenanceRequest(workspaceId, websiteId, requestId);
      } else {
        await api.requestMaintenanceChanges(workspaceId, websiteId, requestId);
      }
      setRequests(await api.listMaintenanceRequests(workspaceId, websiteId));
    } catch {
      setActionError(t("maint.actionError"));
    } finally {
      setBusyId(null);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !description.trim()) return;

    setSubmitting(true);
    setError(null);
    setCoverage(null);
    try {
      const result = await api.createMaintenanceRequest(workspaceId, websiteId, title.trim(), description.trim());
      const updated = await api.listMaintenanceRequests(workspaceId, websiteId);
      setRequests(updated);
      setTitle("");
      setDescription("");
      setCoverage(result.tier);
    } catch {
      setError(t("maint.submitError"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      {requests.length === 0 ? (
        <p className={styles.empty}>{t("maint.empty")}</p>
      ) : (
        <ul className={styles.list}>
          {requests.map((r) => (
            <li key={r.id} className={styles.item}>
              <div className={styles.itemHeader}>
                <span className={styles.itemTitle}>{r.title}</span>
                <span className={`${styles.badge} ${styles[`status_${r.status}`]}`}>{t(`maint.status.${r.status}`)}</span>
              </div>
              <p className={styles.itemDescription}>{r.description}</p>
              {r.priceCents !== null && (
                <p className={styles.itemPrice}>
                  {r.currency} {(r.priceCents / 100).toFixed(2)}
                </p>
              )}
              {r.status === "COMPLETED" && (
                <div className={styles.actions}>
                  <button
                    className={`${styles.action} ${styles.actionPrimary}`}
                    type="button"
                    disabled={busyId === r.id}
                    onClick={() => handleAction("approve", r.id)}
                  >
                    {t("maint.approve")}
                  </button>
                  <button
                    className={styles.action}
                    type="button"
                    disabled={busyId === r.id}
                    onClick={() => handleAction("changes", r.id)}
                  >
                    {t("maint.requestChanges")}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {actionError && <p className={styles.error} role="alert">{actionError}</p>}

      <form className={styles.form} onSubmit={handleSubmit}>
        <p className={styles.formLabel}>{t("maint.formLabel")}</p>
        <input
          className={styles.input}
          placeholder={t("maint.titlePlaceholder")}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={120}
          required
        />
        <textarea
          className={styles.textarea}
          placeholder={t("maint.descPlaceholder")}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          required
        />
        {coverage && (
          <p className={styles.coverageNote} role="status">
            {coverageNote(coverage, t)}
          </p>
        )}
        {error && <p className={styles.error}>{error}</p>}
        <button className={styles.submit} type="submit" disabled={submitting}>
          {submitting ? t("maint.sending") : t("maint.send")}
        </button>
      </form>
    </div>
  );
}
