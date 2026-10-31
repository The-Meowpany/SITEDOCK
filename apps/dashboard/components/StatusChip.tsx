"use client";

import { statusKey } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import styles from "./StatusChip.module.css";

const TONE_CLASS: Record<string, string> = {
  LIVE: "live",
  PAST_DUE: "past_due",
  GRACE_PERIOD: "grace_period",
  SUSPENDED: "suspended",
};

/** Compact status indicator shared by tables across the console. */
export function StatusChip({ status }: { status: string }) {
  const { t } = useI18n();
  const tone = TONE_CLASS[status] ?? status.toLowerCase();
  const key = statusKey(status);
  return (
    <span className={`${styles.chip} ${styles[tone] ?? ""}`}>
      <span className={styles.dot} aria-hidden />
      {key ? t(key) : status}
    </span>
  );
}

/** Numbered checklist shown when the workspace is brand new (empty state). */
export function OnboardingChecklist() {
  const { t } = useI18n();
  return (
    <ol className={styles.onboarding}>
      <li>{t("onboarding.step1")}</li>
      <li>{t("onboarding.step2")}</li>
      <li>{t("onboarding.step3")}</li>
      <li>{t("onboarding.step4")}</li>
      <li>{t("onboarding.step5")}</li>
    </ol>
  );
}
