"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/lib/api-client";
import type { DashboardData } from "@/lib/api-client";
import { ApiError } from "@/lib/api-error";
import { bytes, money, statusKey } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { MetricCard } from "@/components/MetricCard";
import { RevenueChart } from "@/components/RevenueChart";
import { StripeCard } from "@/components/StripeCard";
import styles from "./page.module.css";

function primaryAmount(breakdown: Array<{ currency: string; amountCents: number }>): string {
  if (breakdown.length === 0) return "$0.00";
  const first = breakdown[0]!;
  return money(first.amountCents, first.currency);
}

export default function WorkspaceDashboardPage() {
  const params = useParams<{ workspaceId: string }>();
  const router = useRouter();
  const { t, formatDateTime, formatDate } = useI18n();
  const tRef = useRef(t);
  tRef.current = t;
  const workspaceId = params.workspaceId;

  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getDashboard(workspaceId)
      .then((d) => !cancelled && setData(d))
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) {
          router.replace(`/login?returnTo=/workspaces/${workspaceId}`);
          return;
        }
        setError(err instanceof Error ? err.message : tRef.current("dash.loadError"));
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId, router]);

  if (error) {
    return (
      <main className={styles.page}>
        <p className={styles.error}>{error}</p>
      </main>
    );
  }

  if (!data) {
    return (
      <main className={styles.page}>
        <p className={styles.loading}>{t("dash.loading")}</p>
      </main>
    );
  }

  const churn = data.subscriptions.churnRateLast30Days;

  return (
    <>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>{t("dash.eyebrow")}</p>
          <h1 className={styles.title}>{t("dash.title")}</h1>
        </div>
        <span className={styles.generated}>
          {t("dash.updated", { date: formatDateTime(data.generatedAt) })}
        </span>
      </header>

      <StripeCard />

      <section className={styles.metrics} aria-label={t("dash.metrics.aria")}>
        <MetricCard
          label="MRR"
          value={primaryAmount(data.mrr)}
          hint={`ARR ${primaryAmount(data.arr)}`}
          tone="good"
        />
        <MetricCard
          label={t("dash.activeSubs")}
          value={String(data.subscriptions.active)}
          hint={data.subscriptions.trialing > 0 ? t("dash.trialing", { count: data.subscriptions.trialing }) : undefined}
        />
        <MetricCard
          label={t("dash.liveSites")}
          value={String(data.websites.active)}
          hint={t("dash.totalSites", { count: data.websites.totalExcludingDeleted })}
        />
        <MetricCard
          label={t("dash.mrrAtRisk")}
          value={primaryAmount(data.atRiskMrr)}
          hint={
            data.atRiskMrr.length > 0
              ? t("dash.failedPayments", { count: data.subscriptions.pastDue + data.subscriptions.gracePeriod })
              : t("dash.nothingOverdue")
          }
          tone={data.atRiskMrr.length > 0 ? "warn" : "neutral"}
        />
        <MetricCard
          label={t("dash.failed30")}
          value={String(data.payments.failedLast30Days)}
          tone={data.payments.failedLast30Days > 0 ? "bad" : "neutral"}
        />
        <MetricCard label={t("dash.openRequests")} value={String(data.maintenanceRequestsPending)} />
      </section>

      <div className={styles.grid}>
        <section className={`${styles.panel} ${styles.span2}`} aria-label={t("dash.revenue.aria")}>
          <h2 className={styles.panelTitle}>{t("dash.revenue.title")}</h2>
          <RevenueChart series={data.revenueByMonth} />
        </section>

        <section className={styles.panel} aria-label={t("dash.growth.aria")}>
          <h2 className={styles.panelTitle}>{t("dash.growth.title")}</h2>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">{t("dash.month")}</th>
                <th scope="col">{t("dash.started")}</th>
                <th scope="col">{t("dash.canceled")}</th>
              </tr>
            </thead>
            <tbody>
              {data.subscriptionGrowthByMonth.map((point) => (
                <tr key={point.month}>
                  <td>{point.month}</td>
                  <td className={point.started > 0 ? styles.up : ""}>{point.started || "—"}</td>
                  <td className={point.canceled > 0 ? styles.down : ""}>{point.canceled || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className={styles.churn}>
            {t("dash.churn")}{" "}
            {churn === null ? (
              <em>{t("dash.noData")}</em>
            ) : (
              <strong className={churn > 0.1 ? styles.down : styles.up}>{(churn * 100).toFixed(1)}%</strong>
            )}
            <span className={styles.churnHint}> {t("dash.canceledCount", { count: data.subscriptions.canceledLast30Days })}</span>
          </p>
        </section>

        <section className={styles.panel} aria-label={t("dash.byStatus")}>
          <h2 className={styles.panelTitle}>{t("dash.byStatus")}</h2>
          <ul className={styles.statusList}>
            {Object.entries(data.websites.byStatus)
              .sort((a, b) => b[1] - a[1])
              .map(([status, count]) => (
                <li key={status} className={styles[`st-${status.toLowerCase()}`] ?? undefined}>
                  <span className={styles.dot} aria-hidden />
                  {statusKey(status) ? t(statusKey(status)!) : status}
                  <strong className={styles.count}>{count}</strong>
                </li>
              ))}
            {data.websites.byStatus.LIVE === undefined && Object.keys(data.websites.byStatus).length > 0 && (
              <li className={styles.noneLive}>{t("dash.noneLive")}</li>
            )}
          </ul>
        </section>

        <section className={styles.panel} aria-label={t("dash.ops.aria")}>
          <h2 className={styles.panelTitle}>{t("dash.ops.title")}</h2>
          <ul className={styles.opsList}>
            <li>
              {t("dash.deployments")} <strong>{data.deployments.total}</strong>
              <span className={styles.dim}> {t("dash.deploymentsLast30", { count: data.deployments.last30Days })}</span>
            </li>
            <li>
              {t("dash.storage")} <strong>{bytes(data.deployments.storageBytes)}</strong>
            </li>
            <li>
              {t("dash.clients")} <strong>{data.clients.total}</strong>
              <span className={styles.dim}> {t("dash.clientsActive", { count: data.clients.withActiveService })}</span>
            </li>
            {data.payments.recentFailed.length > 0 && (
              <li className={styles.failedItem}>
                {t("dash.lastFailed")}{" "}
                <strong>
                  {money(
                    data.payments.recentFailed[0]!.amountCents,
                    data.payments.recentFailed[0]!.currency
                  )}
                </strong>{" "}
                <span className={styles.dim}>
                  {formatDate(data.payments.recentFailed[0]!.createdAt)}
                </span>
              </li>
            )}
          </ul>
        </section>

        <section className={`${styles.panel} ${styles.span3}`} aria-label={t("dash.top.aria")}>
          <h2 className={styles.panelTitle}>{t("dash.top.title")}</h2>
          {data.topClients.length === 0 ? (
            <p className={styles.emptyRow}>
              {t("dash.top.emptyPrefix")}<strong>{t("nav.sites")}</strong>{t("dash.top.emptySuffix")}
            </p>
          ) : (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">{t("client.title")}</th>
                  <th scope="col">{t("auth.email")}</th>
                  <th scope="col" className={styles.num}>
                    {t("nav.sites")}
                  </th>
                  <th scope="col" className={styles.num}>
                    {t("dash.monthly")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.topClients.map((row) => (
                  <tr key={row.clientId}>
                    <td>{row.fullName}</td>
                    <td className={styles.dim}>{row.email}</td>
                    <td className={styles.num}>{row.websites}</td>
                    <td className={`${styles.num} ${styles.money}`}>
                      {money(row.monthlyCents, row.currency ?? "USD")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      <footer className={styles.footer}>SiteDock · {t("header.subtitle.developer")}</footer>
    </>
  );
}
