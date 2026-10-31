"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api-client";
import type {
  AdminDnsStatus,
  AdminPaymentRow,
  AdminUserRow,
  AdminWebhookEventRow,
  AdminWebsiteRow,
  DnsProvisionResult,
  PlatformOverview,
  TenantRow,
} from "@/lib/api-client";
import { ApiError } from "@/lib/api-error";
import { bytes, money, statusKey } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { MetricCard } from "@/components/MetricCard";
import { AppHeader } from "@/components/AppHeader";
import styles from "./page.module.css";

function primary(entries: Array<{ currency: string; amountCents: number }>): string {
  if (entries.length === 0) return "$0.00";
  const first = entries[0]!;
  return money(first.amountCents, first.currency);
}

function EmptyRow({ colSpan, children }: { colSpan: number; children: React.ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className={styles.emptyRow}>
        {children}
      </td>
    </tr>
  );
}

export default function AdminConsolePage() {
  const router = useRouter();
  const { t, formatDate, formatDateTime } = useI18n();
  // Always-current translator for async code, so a locale change never re-triggers data loading.
  const tRef = useRef(t);
  tRef.current = t;
  const [overview, setOverview] = useState<PlatformOverview | null>(null);
  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [websites, setWebsites] = useState<AdminWebsiteRow[]>([]);
  const [payments, setPayments] = useState<AdminPaymentRow[]>([]);
  const [events, setEvents] = useState<AdminWebhookEventRow[]>([]);
  const [dnsStatus, setDnsStatus] = useState<AdminDnsStatus | null>(null);
  const [dnsResult, setDnsResult] = useState<DnsProvisionResult | null>(null);
  const [dnsPublicIp, setDnsPublicIp] = useState("");
  const [dnsBusy, setDnsBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [busySiteId, setBusySiteId] = useState<string | null>(null);

  const refreshUsers = useCallback(() => api.listUsers().then(setUsers).catch(() => {}), []);
  const refreshWebsites = useCallback(() => api.listWebsites().then(setWebsites).catch(() => {}), []);

  useEffect(() => {
    Promise.all([
      api.getOverview(),
      api.listTenants(),
      api.listUsers(),
      api.listWebsites(),
      api.listPayments(),
      api.listWebhookEvents(),
      api.getDnsStatus().catch(() => null),
    ])
      .then(([o, tenantRows, u, w, p, e, d]) => {
        setOverview(o);
        setTenants(tenantRows);
        setUsers(u);
        setWebsites(w);
        setPayments(p);
        setEvents(e);
        setDnsStatus(d);
      })
      .catch((err) => {
        if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
          router.replace("/login");
          return;
        }
        setError(err instanceof Error ? err.message : tRef.current("admin.loadError"));
      });
  }, [router]);

  async function toggleSuspend(user: AdminUserRow) {
    setBusyUserId(user.id);
    try {
      if (user.suspendedAt) await api.reinstateUser(user.id);
      else await api.suspendUser(user.id);
      await refreshUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("admin.actionFailed"));
    } finally {
      setBusyUserId(null);
    }
  }

  async function suspendSite(site: AdminWebsiteRow) {
    if (!window.confirm(t("admin.confirmSuspendSite", { site: site.name, workspace: site.workspaceName }))) return;
    setBusySiteId(site.id);
    try {
      await api.suspendWebsite(site.id);
      await refreshWebsites();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("admin.actionFailed"));
    } finally {
      setBusySiteId(null);
    }
  }

  async function provisionDns(apply: boolean) {
    if (apply && !window.confirm(t("admin.confirmDns"))) return;
    setDnsBusy(apply ? "apply" : "dry-run");
    setError(null);
    try {
      const publicIp = dnsPublicIp.trim();
      const result = await api.provisionDns({ apply, publicIp: publicIp || undefined });
      setDnsResult(result);
      setDnsStatus(await api.getDnsStatus().catch(() => dnsStatus));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("admin.dnsProvisionError"));
    } finally {
      setDnsBusy(null);
    }
  }

  if (error && !overview) {
    return (
      <main className={styles.page}>
        <p className={styles.error}>{error}</p>
      </main>
    );
  }

  if (!overview) {
    return (
      <main className={styles.page}>
        <p className={styles.loading}>{t("admin.opening")}</p>
      </main>
    );
  }

  const liveCount = overview.websitesByStatus.LIVE ?? 0;

  return (
    <main className={styles.page}>
      <AppHeader subtitle={t("admin.subtitle")} />

      <nav className={styles.sectionNav} aria-label={t("admin.nav.aria")}>
        <a href="#metricas">{t("admin.nav.metrics")}</a>
        <a href="#tenants">{t("admin.nav.tenants")}</a>
        <a href="#usuarios">{t("admin.nav.users")}</a>
        <a href="#sitios">{t("admin.nav.sites")}</a>
        <a href="#dns">{t("admin.nav.dns")}</a>
        <a href="#pagos">{t("admin.nav.payments")}</a>
      </nav>

      {error && <p className={styles.error}>{error}</p>}

      <section id="metricas" className={styles.metrics} aria-label={t("admin.metrics.aria")}>
        <MetricCard label={t("admin.mrr")} value={primary(overview.mrrByCurrency)} hint={`ARR ${primary(overview.arrByCurrency)}`} tone="good" />
        <MetricCard label={t("admin.activeSubs")} value={String(overview.activeSubscriptionCount)} />
        <MetricCard label={t("admin.liveSites")} value={String(liveCount)} hint={t("admin.totalSites", { count: Object.values(overview.websitesByStatus).reduce((a, b) => a + b, 0) })} />
        <MetricCard label={t("admin.failed30")} value={String(overview.failedPaymentsLast30Days)} tone={overview.failedPaymentsLast30Days > 0 ? "bad" : "neutral"} />
        <MetricCard label={t("admin.deployments")} value={String(overview.deploymentsTotal)} hint={bytes(overview.storageBytes)} />
      </section>

      <section id="tenants" className={styles.panel} aria-label={t("admin.tenants.aria")}>
        <h2 className={styles.panelTitle}>{t("admin.tenants.title")}</h2>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">{t("admin.col.name")}</th>
              <th scope="col">{t("admin.col.slug")}</th>
              <th scope="col" className={styles.num}>
                {t("admin.col.sites")}
              </th>
              <th scope="col" className={styles.num}>
                {t("admin.col.activeSubs")}
              </th>
              <th scope="col">{t("admin.col.created")}</th>
            </tr>
          </thead>
          <tbody>
            {tenants.length === 0 ? (
              <EmptyRow colSpan={5}>{t("admin.tenants.empty")}</EmptyRow>
            ) : (
              tenants.map((tenant) => (
                <tr key={tenant.id}>
                  <td>{tenant.name}</td>
                  <td className={styles.dim}>{tenant.slug}</td>
                  <td className={styles.num}>{tenant.websiteCount}</td>
                  <td className={styles.num}>{tenant.activeSubscriptionCount}</td>
                  <td className={styles.dim}>{formatDate(tenant.createdAt)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>

      <section id="usuarios" className={styles.panel} aria-label={t("admin.users.aria")}>
        <h2 className={styles.panelTitle}>{t("admin.users.aria")}</h2>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">{t("admin.col.name")}</th>
              <th scope="col">{t("admin.col.email")}</th>
              <th scope="col">{t("admin.col.role")}</th>
              <th scope="col">{t("admin.col.status")}</th>
              <th scope="col" aria-label={t("admin.col.actions")} />
            </tr>
          </thead>
          <tbody>
            {users.length === 0 ? (
              <EmptyRow colSpan={5}>{t("admin.users.empty")}</EmptyRow>
            ) : (
              users.map((u) => (
                <tr key={u.id} className={u.suspendedAt ? styles.rowSuspended : ""}>
                  <td>{u.fullName}</td>
                  <td className={styles.dim}>{u.email}</td>
                  <td>{u.platformRole}</td>
                  <td>{u.suspendedAt ? t("admin.user.suspended") : t("admin.user.active")}</td>
                  <td className={styles.num}>
                    <button
                      className={u.suspendedAt ? styles.btnGood : styles.btnDanger}
                      disabled={busyUserId === u.id}
                      onClick={() => toggleSuspend(u)}
                    >
                      {busyUserId === u.id ? "…" : u.suspendedAt ? t("admin.user.reinstate") : t("admin.user.suspend")}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>

      <section id="sitios" className={styles.panel} aria-label={t("admin.sites.aria")}>
        <h2 className={styles.panelTitle}>{t("admin.sites.title")}</h2>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">{t("admin.col.site")}</th>
              <th scope="col">{t("admin.col.workspace")}</th>
              <th scope="col">{t("admin.col.status")}</th>
              <th scope="col" aria-label={t("admin.col.actions")} />
            </tr>
          </thead>
          <tbody>
            {websites.length === 0 ? (
              <EmptyRow colSpan={4}>{t("admin.sites.empty")}</EmptyRow>
            ) : (
              websites.map((w) => (
                <tr key={w.id}>
                  <td>
                    {w.name}
                    <span className={styles.dim}> · {w.subdomain}</span>
                  </td>
                  <td className={styles.dim}>{w.workspaceName}</td>
                  <td>{statusKey(w.status) ? t(statusKey(w.status)!) : w.status}</td>
                  <td className={styles.num}>
                    {w.status !== "SUSPENDED" && w.status !== "DELETED" && (
                      <button className={styles.btnDanger} disabled={busySiteId === w.id} onClick={() => suspendSite(w)}>
                        {busySiteId === w.id ? "…" : t("admin.user.suspend")}
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>

      <section id="dns" className={styles.panel} aria-label={t("admin.dns.aria")}>
        <h2 className={styles.panelTitle}>{t("admin.dns.title")}</h2>
        {!dnsStatus ? (
          <p className={styles.dim}>{t("admin.dns.unavailable")}</p>
        ) : !dnsStatus.configured ? (
          <>
            <p className={styles.down}>{dnsStatus.message}</p>
            <p className={styles.dim}>
              {t("admin.dns.configureHint")}
            </p>
          </>
        ) : (
          <>
            <table className={styles.table}>
              <tbody>
                <tr>
                  <th scope="row">{t("admin.dns.baseDomain")}</th>
                  <td className={styles.money}>{dnsStatus.baseDomain ?? "—"}</td>
                  <th scope="row">{t("admin.dns.zone")}</th>
                  <td>{dnsStatus.zoneFound ? dnsStatus.zone?.fullDomain : t("admin.dns.notFound")}</td>
                </tr>
                <tr>
                  <th scope="row">{t("admin.dns.zoneStatus")}</th>
                  <td>{dnsStatus.zone?.status ?? "—"}</td>
                  <th scope="row">{t("admin.dns.expires")}</th>
                  <td className={styles.dim}>
                    {dnsStatus.zone?.expiresAt ? formatDate(dnsStatus.zone.expiresAt) : "—"}
                  </td>
                </tr>
                <tr>
                  <th scope="row">{t("admin.dns.publicIp")}</th>
                  <td className={dnsStatus.publicIpConfigured ? styles.up : styles.down}>
                    {dnsStatus.publicIpConfigured ? t("admin.dns.configured") : t("admin.dns.missingIp")}
                  </td>
                  <th scope="row">{t("admin.dns.records")}</th>
                  <td>{dnsStatus.recordCount ?? 0}</td>
                </tr>
              </tbody>
            </table>

            <div className={styles.inlineForm}>
              <input
                className={styles.input}
                placeholder={t("admin.dns.ipPlaceholder")}
                value={dnsPublicIp}
                onChange={(e) => setDnsPublicIp(e.target.value)}
                aria-label={t("admin.dns.publicIp")}
              />
              <button className={styles.btnGood} disabled={!!dnsBusy} onClick={() => provisionDns(false)}>
                {dnsBusy === "dry-run" ? t("admin.dns.simulating") : t("admin.dns.simulate")}
              </button>
              <button className={styles.btnDanger} disabled={!!dnsBusy} onClick={() => provisionDns(true)}>
                {dnsBusy === "apply" ? t("admin.dns.applying") : t("admin.dns.apply")}
              </button>
            </div>

            <h2 className={`${styles.panelTitle} ${styles.spaced}`}>{t("admin.dns.zoneRecords")}</h2>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">{t("admin.col.name")}</th>
                  <th scope="col">{t("admin.col.type")}</th>
                  <th scope="col">{t("admin.col.value")}</th>
                  <th scope="col">{t("admin.col.ttl")}</th>
                </tr>
              </thead>
              <tbody>
                {(dnsStatus.records ?? []).length === 0 ? (
                  <EmptyRow colSpan={4}>{t("admin.dns.noRecords")}</EmptyRow>
                ) : (
                  (dnsStatus.records ?? []).map((record) => (
                    <tr key={`${record.type}-${record.name}-${record.value}`}>
                      <td className={styles.money}>{record.name}</td>
                      <td>{record.type}</td>
                      <td className={styles.dim}>{record.value}</td>
                      <td className={styles.dim}>{record.ttl}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>

            {dnsResult && (
              <>
                <h2 className={`${styles.panelTitle} ${styles.spaced}`}>
                  {dnsResult.applied ? t("admin.dns.resultApplied") : t("admin.dns.resultDryRun")}
                </h2>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th scope="col">{t("admin.col.name")}</th>
                      <th scope="col">{t("admin.col.type")}</th>
                      <th scope="col">{t("admin.col.value")}</th>
                      <th scope="col">{t("admin.col.action")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dnsResult.records.map((record) => (
                      <tr key={`${record.type}-${record.name}`}>
                        <td className={styles.money}>{record.name}</td>
                        <td>{record.type}</td>
                        <td className={styles.dim}>{record.value}</td>
                        <td className={record.action === "conflict" ? styles.down : record.action === "create" ? styles.up : ""}>
                          {record.action}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </>
        )}
      </section>

      <section id="pagos" className={styles.panel} aria-label={t("admin.payments.aria")}>
        <h2 className={styles.panelTitle}>{t("admin.payments.title")}</h2>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">{t("admin.col.amount")}</th>
              <th scope="col">{t("admin.col.status")}</th>
              <th scope="col">{t("admin.col.provider")}</th>
              <th scope="col">{t("admin.col.date")}</th>
            </tr>
          </thead>
          <tbody>
            {payments.length === 0 ? (
              <EmptyRow colSpan={4}>{t("admin.payments.empty")}</EmptyRow>
            ) : (
              payments.map((p) => (
                <tr key={p.id}>
                  <td className={styles.money}>{money(p.amountCents, p.currency)}</td>
                  <td className={p.status === "FAILED" ? styles.down : p.status === "SUCCEEDED" ? styles.up : ""}>{p.status}</td>
                  <td className={styles.dim}>{p.provider}</td>
                  <td className={styles.dim}>{formatDateTime(p.createdAt)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        <h2 className={`${styles.panelTitle} ${styles.spaced}`}>{t("admin.webhooks.title")}</h2>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">{t("admin.col.type")}</th>
              <th scope="col">{t("admin.col.provider")}</th>
              <th scope="col">{t("admin.col.processing")}</th>
              <th scope="col">{t("admin.col.received")}</th>
            </tr>
          </thead>
          <tbody>
            {events.length === 0 ? (
              <EmptyRow colSpan={4}>{t("admin.webhooks.empty")}</EmptyRow>
            ) : (
              events.map((e) => (
                <tr key={e.id}>
                  <td className={styles.money}>{e.eventType}</td>
                  <td className={styles.dim}>{e.provider}</td>
                  <td>{e.processingStatus}</td>
                  <td className={styles.dim}>{formatDateTime(e.receivedAt)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>

      <footer className={styles.footer}>{t("admin.footer")}</footer>
    </main>
  );
}
