"use client";

import { useCallback, useEffect, useState } from "react";
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
import { bytes, money, statusLabel } from "@/lib/format";
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
      .then(([o, t, u, w, p, e, d]) => {
        setOverview(o);
        setTenants(t);
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
        setError(err instanceof Error ? err.message : "No pudimos cargar el panel.");
      });
  }, [router]);

  async function toggleSuspend(user: AdminUserRow) {
    setBusyUserId(user.id);
    try {
      if (user.suspendedAt) await api.reinstateUser(user.id);
      else await api.suspendUser(user.id);
      await refreshUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "La acción falló.");
    } finally {
      setBusyUserId(null);
    }
  }

  async function suspendSite(site: AdminWebsiteRow) {
    if (!window.confirm(`¿Suspender "${site.name}" (${site.workspaceName})? Esta acción notifica al cliente.`)) return;
    setBusySiteId(site.id);
    try {
      await api.suspendWebsite(site.id);
      await refreshWebsites();
    } catch (err) {
      setError(err instanceof Error ? err.message : "La acción falló.");
    } finally {
      setBusySiteId(null);
    }
  }

  async function provisionDns(apply: boolean) {
    if (apply && !window.confirm("Crear los registros A @ y * en la zona base de DNSHE?")) return;
    setDnsBusy(apply ? "apply" : "dry-run");
    setError(null);
    try {
      const publicIp = dnsPublicIp.trim();
      const result = await api.provisionDns({ apply, publicIp: publicIp || undefined });
      setDnsResult(result);
      setDnsStatus(await api.getDnsStatus().catch(() => dnsStatus));
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos provisionar DNS.");
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
        <p className={styles.loading}>Abriendo el panel de plataforma…</p>
      </main>
    );
  }

  const liveCount = overview.websitesByStatus.LIVE ?? 0;

  return (
    <main className={styles.page}>
      <AppHeader subtitle="Administración de plataforma" />

      <nav className={styles.sectionNav} aria-label="Secciones">
        <a href="#metricas">Métricas</a>
        <a href="#tenants">Workspaces</a>
        <a href="#usuarios">Usuarios</a>
        <a href="#sitios">Sitios</a>
        <a href="#dns">DNSHE</a>
        <a href="#pagos">Pagos y webhooks</a>
      </nav>

      {error && <p className={styles.error}>{error}</p>}

      <section id="metricas" className={styles.metrics} aria-label="Métricas de plataforma">
        <MetricCard label="MRR plataforma" value={primary(overview.mrrByCurrency)} hint={`ARR ${primary(overview.arrByCurrency)}`} tone="good" />
        <MetricCard label="Suscripciones activas" value={String(overview.activeSubscriptionCount)} />
        <MetricCard label="Sitios LIVE" value={String(liveCount)} hint={`${Object.values(overview.websitesByStatus).reduce((a, b) => a + b, 0)} sitios en total`} />
        <MetricCard label="Pagos fallidos (30d)" value={String(overview.failedPaymentsLast30Days)} tone={overview.failedPaymentsLast30Days > 0 ? "bad" : "neutral"} />
        <MetricCard label="Deployments" value={String(overview.deploymentsTotal)} hint={bytes(overview.storageBytes)} />
      </section>

      <section id="tenants" className={styles.panel} aria-label="Tenants">
        <h2 className={styles.panelTitle}>Workspaces (tenants)</h2>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Nombre</th>
              <th scope="col">Slug</th>
              <th scope="col" className={styles.num}>
                Sitios
              </th>
              <th scope="col" className={styles.num}>
                Subs activas
              </th>
              <th scope="col">Creado</th>
            </tr>
          </thead>
          <tbody>
            {tenants.length === 0 ? (
              <EmptyRow colSpan={5}>Sin workspaces todavía.</EmptyRow>
            ) : (
              tenants.map((t) => (
                <tr key={t.id}>
                  <td>{t.name}</td>
                  <td className={styles.dim}>{t.slug}</td>
                  <td className={styles.num}>{t.websiteCount}</td>
                  <td className={styles.num}>{t.activeSubscriptionCount}</td>
                  <td className={styles.dim}>{new Date(t.createdAt).toLocaleDateString("es")}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>

      <section id="usuarios" className={styles.panel} aria-label="Usuarios">
        <h2 className={styles.panelTitle}>Usuarios</h2>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Nombre</th>
              <th scope="col">Email</th>
              <th scope="col">Rol</th>
              <th scope="col">Estado</th>
              <th scope="col" aria-label="Acciones" />
            </tr>
          </thead>
          <tbody>
            {users.length === 0 ? (
              <EmptyRow colSpan={5}>Sin usuarios registrados.</EmptyRow>
            ) : (
              users.map((u) => (
                <tr key={u.id} className={u.suspendedAt ? styles.rowSuspended : ""}>
                  <td>{u.fullName}</td>
                  <td className={styles.dim}>{u.email}</td>
                  <td>{u.platformRole}</td>
                  <td>{u.suspendedAt ? "Suspendido" : "Activo"}</td>
                  <td className={styles.num}>
                    <button
                      className={u.suspendedAt ? styles.btnGood : styles.btnDanger}
                      disabled={busyUserId === u.id}
                      onClick={() => toggleSuspend(u)}
                    >
                      {busyUserId === u.id ? "…" : u.suspendedAt ? "Reactivar" : "Suspender"}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>

      <section id="sitios" className={styles.panel} aria-label="Sitios">
        <h2 className={styles.panelTitle}>Sitios recientes</h2>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Sitio</th>
              <th scope="col">Workspace</th>
              <th scope="col">Estado</th>
              <th scope="col" aria-label="Acciones" />
            </tr>
          </thead>
          <tbody>
            {websites.length === 0 ? (
              <EmptyRow colSpan={4}>Sin sitios creados todavía.</EmptyRow>
            ) : (
              websites.map((w) => (
                <tr key={w.id}>
                  <td>
                    {w.name}
                    <span className={styles.dim}> · {w.subdomain}</span>
                  </td>
                  <td className={styles.dim}>{w.workspaceName}</td>
                  <td>{statusLabel(w.status)}</td>
                  <td className={styles.num}>
                    {w.status !== "SUSPENDED" && w.status !== "DELETED" && (
                      <button className={styles.btnDanger} disabled={busySiteId === w.id} onClick={() => suspendSite(w)}>
                        {busySiteId === w.id ? "…" : "Suspender"}
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>

      <section id="dns" className={styles.panel} aria-label="DNSHE">
        <h2 className={styles.panelTitle}>DNSHE / dominio base</h2>
        {!dnsStatus ? (
          <p className={styles.dim}>No pudimos consultar el estado de DNSHE.</p>
        ) : !dnsStatus.configured ? (
          <>
            <p className={styles.down}>{dnsStatus.message}</p>
            <p className={styles.dim}>
              Configurá DNSHE_API_KEY, DNSHE_API_SECRET, SITEDOCK_BASE_DOMAIN y SITEDOCK_PUBLIC_IP para gestionar la zona.
            </p>
          </>
        ) : (
          <>
            <table className={styles.table}>
              <tbody>
                <tr>
                  <th scope="row">Dominio base</th>
                  <td className={styles.money}>{dnsStatus.baseDomain ?? "—"}</td>
                  <th scope="row">Zona</th>
                  <td>{dnsStatus.zoneFound ? dnsStatus.zone?.fullDomain : "No encontrada"}</td>
                </tr>
                <tr>
                  <th scope="row">Estado de zona</th>
                  <td>{dnsStatus.zone?.status ?? "—"}</td>
                  <th scope="row">Vence</th>
                  <td className={styles.dim}>
                    {dnsStatus.zone?.expiresAt ? new Date(dnsStatus.zone.expiresAt).toLocaleDateString("es") : "—"}
                  </td>
                </tr>
                <tr>
                  <th scope="row">IP pública</th>
                  <td className={dnsStatus.publicIpConfigured ? styles.up : styles.down}>
                    {dnsStatus.publicIpConfigured ? "Configurada" : "Falta SITEDOCK_PUBLIC_IP"}
                  </td>
                  <th scope="row">Registros</th>
                  <td>{dnsStatus.recordCount ?? 0}</td>
                </tr>
              </tbody>
            </table>

            <div className={styles.inlineForm}>
              <input
                className={styles.input}
                placeholder="IP pública (opcional si está en .env)"
                value={dnsPublicIp}
                onChange={(e) => setDnsPublicIp(e.target.value)}
                aria-label="IP pública"
              />
              <button className={styles.btnGood} disabled={!!dnsBusy} onClick={() => provisionDns(false)}>
                {dnsBusy === "dry-run" ? "Simulando…" : "Simular A @ y *"}
              </button>
              <button className={styles.btnDanger} disabled={!!dnsBusy} onClick={() => provisionDns(true)}>
                {dnsBusy === "apply" ? "Aplicando…" : "Aplicar A @ y *"}
              </button>
            </div>

            <h2 className={`${styles.panelTitle} ${styles.spaced}`}>Registros de la zona</h2>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Nombre</th>
                  <th scope="col">Tipo</th>
                  <th scope="col">Valor</th>
                  <th scope="col">TTL</th>
                </tr>
              </thead>
              <tbody>
                {(dnsStatus.records ?? []).length === 0 ? (
                  <EmptyRow colSpan={4}>La zona no tiene registros.</EmptyRow>
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
                  Resultado {dnsResult.applied ? "(aplicado)" : "(simulación)"}
                </h2>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th scope="col">Nombre</th>
                      <th scope="col">Tipo</th>
                      <th scope="col">Valor</th>
                      <th scope="col">Acción</th>
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

      <section id="pagos" className={styles.panel} aria-label="Pagos y webhooks">
        <h2 className={styles.panelTitle}>Pagos recientes</h2>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Monto</th>
              <th scope="col">Estado</th>
              <th scope="col">Provider</th>
              <th scope="col">Fecha</th>
            </tr>
          </thead>
          <tbody>
            {payments.length === 0 ? (
              <EmptyRow colSpan={4}>Sin pagos procesados todavía.</EmptyRow>
            ) : (
              payments.map((p) => (
                <tr key={p.id}>
                  <td className={styles.money}>{money(p.amountCents, p.currency)}</td>
                  <td className={p.status === "FAILED" ? styles.down : p.status === "SUCCEEDED" ? styles.up : ""}>{p.status}</td>
                  <td className={styles.dim}>{p.provider}</td>
                  <td className={styles.dim}>{new Date(p.createdAt).toLocaleString("es")}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        <h2 className={`${styles.panelTitle} ${styles.spaced}`}>Eventos de webhook (ledger idempotente)</h2>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Tipo</th>
              <th scope="col">Provider</th>
              <th scope="col">Procesamiento</th>
              <th scope="col">Recibido</th>
            </tr>
          </thead>
          <tbody>
            {events.length === 0 ? (
              <EmptyRow colSpan={4}>Sin eventos de webhook recibidos.</EmptyRow>
            ) : (
              events.map((e) => (
                <tr key={e.id}>
                  <td className={styles.money}>{e.eventType}</td>
                  <td className={styles.dim}>{e.provider}</td>
                  <td>{e.processingStatus}</td>
                  <td className={styles.dim}>{new Date(e.receivedAt).toLocaleString("es")}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>

      <footer className={styles.footer}>Cada acción de este panel queda registrada en el audit log.</footer>
    </main>
  );
}
