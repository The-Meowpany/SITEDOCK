"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/lib/api-client";
import type { DashboardData } from "@/lib/api-client";
import { ApiError } from "@/lib/api-error";
import { bytes, money, statusLabel } from "@/lib/format";
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
        setError(err instanceof Error ? err.message : "No pudimos cargar tu consola.");
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
        <p className={styles.loading}>Leyendo tu cartera…</p>
      </main>
    );
  }

  const churn = data.subscriptions.churnRateLast30Days;

  return (
    <>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Resumen del workspace</p>
          <h1 className={styles.title}>Tu cartera recurrente</h1>
        </div>
        <span className={styles.generated}>
          Actualizado {new Date(data.generatedAt).toLocaleString("es")}
        </span>
      </header>

      <StripeCard />

      <section className={styles.metrics} aria-label="Métricas principales">
        <MetricCard
          label="MRR"
          value={primaryAmount(data.mrr)}
          hint={`ARR ${primaryAmount(data.arr)}`}
          tone="good"
        />
        <MetricCard
          label="Suscripciones activas"
          value={String(data.subscriptions.active)}
          hint={data.subscriptions.trialing > 0 ? `${data.subscriptions.trialing} en prueba` : undefined}
        />
        <MetricCard
          label="Sitios en línea"
          value={String(data.websites.active)}
          hint={`${data.websites.totalExcludingDeleted} sitios en total`}
        />
        <MetricCard
          label="MRR en riesgo"
          value={primaryAmount(data.atRiskMrr)}
          hint={
            data.atRiskMrr.length > 0
              ? `${data.subscriptions.pastDue + data.subscriptions.gracePeriod} con pago fallido`
              : "Nada vencido"
          }
          tone={data.atRiskMrr.length > 0 ? "warn" : "neutral"}
        />
        <MetricCard
          label="Pagos fallidos (30d)"
          value={String(data.payments.failedLast30Days)}
          tone={data.payments.failedLast30Days > 0 ? "bad" : "neutral"}
        />
        <MetricCard label="Solicitudes abiertas" value={String(data.maintenanceRequestsPending)} />
      </section>

      <div className={styles.grid}>
        <section className={`${styles.panel} ${styles.span2}`} aria-label="Ingresos">
          <h2 className={styles.panelTitle}>Ingresos cobrados</h2>
          <RevenueChart series={data.revenueByMonth} />
        </section>

        <section className={styles.panel} aria-label="Crecimiento">
          <h2 className={styles.panelTitle}>Altas y bajas</h2>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Mes</th>
                <th scope="col">Altas</th>
                <th scope="col">Bajas</th>
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
            Churn 30d:{" "}
            {churn === null ? (
              <em>sin datos</em>
            ) : (
              <strong className={churn > 0.1 ? styles.down : styles.up}>{(churn * 100).toFixed(1)}%</strong>
            )}
            <span className={styles.churnHint}> ({data.subscriptions.canceledLast30Days} canceladas)</span>
          </p>
        </section>

        <section className={styles.panel} aria-label="Sitios por estado">
          <h2 className={styles.panelTitle}>Sitios por estado</h2>
          <ul className={styles.statusList}>
            {Object.entries(data.websites.byStatus)
              .sort((a, b) => b[1] - a[1])
              .map(([status, count]) => (
                <li key={status} className={styles[`st-${status.toLowerCase()}`] ?? undefined}>
                  <span className={styles.dot} aria-hidden />
                  {statusLabel(status)}
                  <strong className={styles.count}>{count}</strong>
                </li>
              ))}
            {data.websites.byStatus.LIVE === undefined && Object.keys(data.websites.byStatus).length > 0 && (
              <li className={styles.noneLive}>Ningún sitio está LIVE todavía.</li>
            )}
          </ul>
        </section>

        <section className={styles.panel} aria-label="Infraestructura">
          <h2 className={styles.panelTitle}>Operación</h2>
          <ul className={styles.opsList}>
            <li>
              Deployments <strong>{data.deployments.total}</strong>
              <span className={styles.dim}> ({data.deployments.last30Days} últimos 30d)</span>
            </li>
            <li>
              Almacenamiento <strong>{bytes(data.deployments.storageBytes)}</strong>
            </li>
            <li>
              Clientes <strong>{data.clients.total}</strong>
              <span className={styles.dim}> ({data.clients.withActiveService} con servicio activo)</span>
            </li>
            {data.payments.recentFailed.length > 0 && (
              <li className={styles.failedItem}>
                Último pago fallido{" "}
                <strong>
                  {money(
                    data.payments.recentFailed[0]!.amountCents,
                    data.payments.recentFailed[0]!.currency
                  )}
                </strong>{" "}
                <span className={styles.dim}>
                  {new Date(data.payments.recentFailed[0]!.createdAt).toLocaleDateString("es")}
                </span>
              </li>
            )}
          </ul>
        </section>

        <section className={`${styles.panel} ${styles.span3}`} aria-label="Mejores clientes">
          <h2 className={styles.panelTitle}>Principales clientes</h2>
          {data.topClients.length === 0 ? (
            <p className={styles.emptyRow}>
              Todavía no hay suscripciones activas. Andá a <strong>Sitios</strong> para crear tu primero.
            </p>
          ) : (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Cliente</th>
                  <th scope="col">Email</th>
                  <th scope="col" className={styles.num}>
                    Sitios
                  </th>
                  <th scope="col" className={styles.num}>
                    Mensual
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

      <footer className={styles.footer}>SiteDock · Consola del developer</footer>
    </>
  );
}
