"use client";

import styles from "./SubscriptionReceipt.module.css";
import type { SubscriptionDetail } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";

export function SubscriptionReceipt({ subscription }: { subscription: SubscriptionDetail | null }) {
  const { t, formatDate } = useI18n();
  const date = (iso: string | null) => (iso ? formatDate(iso) : "—");

  if (!subscription) {
    return <p className={styles.empty}>{t("sub.empty")}</p>;
  }

  const intervalLabel = subscription.billingInterval === "MONTHLY" ? t("sub.perMonth") : t("sub.perYear");

  return (
    <dl className={styles.receipt}>
      <div className={styles.line}>
        <dt>{t("sub.plan")}</dt>
        <dd className={styles.amount}>
          {subscription.currency} {subscription.priceDecimal} <span className={styles.perInterval}>/ {intervalLabel}</span>
        </dd>
      </div>
      <div className={styles.line}>
        <dt>{t("sub.statusLabel")}</dt>
        <dd>{t(`sub.status.${subscription.status}`)}</dd>
      </div>
      <div className={styles.line}>
        <dt>{t("sub.nextRenewal")}</dt>
        <dd className={styles.mono}>{date(subscription.nextBillingDate)}</dd>
      </div>
      {subscription.gracePeriodEndsAt && (
        <div className={styles.line}>
          <dt>{t("sub.graceEnds")}</dt>
          <dd className={styles.mono}>{date(subscription.gracePeriodEndsAt)}</dd>
        </div>
      )}
    </dl>
  );
}
