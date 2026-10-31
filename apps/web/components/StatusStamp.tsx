"use client";

import styles from "./StatusStamp.module.css";
import type { WebsiteDetail } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";

type SiteStatus = WebsiteDetail["status"];

const STAMP_TONE: Record<SiteStatus, "live" | "warn" | "danger" | "neutral"> = {
  LIVE: "live",
  PAST_DUE: "warn",
  GRACE_PERIOD: "warn",
  SUSPENDED: "danger",
  DRAFT: "neutral",
  PREVIEW: "neutral",
  PENDING_APPROVAL: "neutral",
  APPROVED: "neutral",
  ARCHIVED: "neutral",
  DELETED: "neutral",
};

export function StatusStamp({ status }: { status: SiteStatus }) {
  const { t } = useI18n();
  const tone = STAMP_TONE[status];
  const label = t(`site.status.${status}`);
  const isLive = status === "LIVE";

  return (
    <div className={styles.row}>
      <div className={`${styles.stamp} ${styles[tone]}`} role="status" aria-label={t("stamp.aria", { label })}>
        {isLive && <span className={styles.pulse} aria-hidden="true" />}
        <span className={styles.stampLabel}>{label}</span>
      </div>
      <p className={styles.note}>{t(`site.note.${status}`)}</p>
    </div>
  );
}
