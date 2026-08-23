"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/lib/api-client";
import type {
  ChargeSummary,
  ClientSummary,
  DeploymentSummary,
  MaintenanceRequestSummary,
  PlanDetail,
  SubscriptionDetail,
  WebsiteSummary,
} from "@/lib/api-client";
import { ApiError } from "@/lib/api-error";
import { money, moneyFromDecimal } from "@/lib/format";
import { StatusChip } from "@/components/StatusChip";
import { Field, btnGhost, btnPrimary, formRow, inputClass, selectClass } from "@/components/ui";
import styles from "./page.module.css";

const REQ_STATUS: Record<MaintenanceRequestSummary["status"], string> = {
  OPEN: "Recibida",
  IN_PROGRESS: "En progreso",
  WAITING_CLIENT: "Esperando cliente",
  PENDING_PAYMENT: "Pendiente de pago",
  PAID: "Pagada",
  COMPLETED: "Completada",
  APPROVED: "Aprobada",
  CANCELED: "Cancelada",
};

export default function SiteConsolePage() {
  const params = useParams<{ workspaceId: string; websiteId: string }>();
  const router = useRouter();
  const workspaceId = params.workspaceId;
  const websiteId = params.websiteId;

  const [site, setSite] = useState<WebsiteSummary | null>(null);
  const [deployments, setDeployments] = useState<DeploymentSummary[]>([]);
  const [clients, setClients] = useState<ClientSummary[]>([]);
  const [plans, setPlans] = useState<PlanDetail[]>([]);
  const [hostingSub, setHostingSub] = useState<SubscriptionDetail | null>(null);
  const [tierSub, setTierSub] = useState<SubscriptionDetail | null>(null);
  const [requests, setRequests] = useState<MaintenanceRequestSummary[]>([]);
  const [charges, setCharges] = useState<ChargeSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Form states
  const [clientMode, setClientMode] = useState<"pick" | "new">("new");
  const [clientId, setClientId] = useState("");
  const [newClientName, setNewClientName] = useState("");
  const [newClientEmail, setNewClientEmail] = useState("");
  const [hostingPlanId, setHostingPlanId] = useState("");
  const [tierPlanId, setTierPlanId] = useState("");
  const [chargeTitle, setChargeTitle] = useState("");
  const [chargePrice, setChargePrice] = useState("");

  const refresh = useCallback(async () => {
    const [siteData, deploymentsData, clientsData, plansData, hostingSubData, tierSubData, requestsData, chargesData, allowanceData] =
      await Promise.all([
        api.getWebsite(workspaceId, websiteId),
        api.listDeployments(workspaceId, websiteId),
        api.listClients(workspaceId),
        api.listPlans(workspaceId),
        api.getSubscription(workspaceId, websiteId, "HOSTING"),
        api.getSubscription(workspaceId, websiteId, "MAINTENANCE"),
        api.listMaintenanceRequests(workspaceId, websiteId).catch(() => [] as MaintenanceRequestSummary[]),
        api.listCharges(workspaceId, websiteId).catch(() => [] as ChargeSummary[]),
        api.getAllowance(workspaceId, websiteId).catch(() => null),
      ]);
    setSite(siteData);
    setDeployments(deploymentsData);
    setClients(clientsData);
    setPlans(plansData);
    setHostingSub(hostingSubData);
    setTierSub(tierSubData);
    setRequests(requestsData);
    setCharges(chargesData);
    return allowanceData;
  }, [workspaceId, websiteId]);

  const [allowance, setAllowance] = useState<Awaited<ReturnType<typeof api.getAllowance>> | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([refresh()])
      .then(([allowanceResult]) => {
        if (!cancelled) setAllowance(allowanceResult);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) {
          router.replace(`/login?returnTo=/workspaces/${workspaceId}/sitios/${websiteId}`);
          return;
        }
        setError(err instanceof Error ? err.message : "No pudimos cargar el sitio.");
      });
    return () => {
      cancelled = true;
    };
  }, [refresh, router, workspaceId, websiteId]);

  function guard<A extends unknown[]>(fn: (...args: A) => Promise<unknown>, key: string) {
    return async (...args: A) => {
      setBusy(key);
      setError(null);
      try {
        await fn(...args);
      } catch (err) {
        setError(err instanceof Error ? err.message : "La acción falló.");
      } finally {
        setBusy(null);
      }
    };
  }

  async function reloadAllowance() {
    try {
      setAllowance(await api.getAllowance(workspaceId, websiteId));
    } catch {
      /* noop */
    }
  }

  async function copyText(key: string, value: string) {
    await navigator.clipboard.writeText(value).catch(() => {});
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1800);
  }

  // ── Deploy & versiones ───────────────────────────────────
  const uploadZip = guard(async (file: File) => {
    await api.uploadDeployment(workspaceId, websiteId, file);
    setDeployments(await api.listDeployments(workspaceId, websiteId));
    setSite(await api.getWebsite(workspaceId, websiteId));
  }, "upload");

  /** Publica encadenando submit→approve→publish con tolerancia a transiciones ya hechas. */
  async function fullPublish(deploymentId: string) {
    for (const step of [
      () => api.submitForApproval(workspaceId, websiteId),
      () => api.approveWebsite(workspaceId, websiteId),
      () => api.publishDeployment(workspaceId, websiteId, deploymentId),
    ]) {
      await step().catch(() => undefined); // transiciones ya aplicadas no son errores aquí
    }
    await api.publishDeployment(workspaceId, websiteId, deploymentId);
    setDeployments(await api.listDeployments(workspaceId, websiteId));
    setSite(await api.getWebsite(workspaceId, websiteId));
  }

  const doPublish = guard(async (deploymentId: string) => {
    await fullPublish(deploymentId);
  }, `publish-${"x"}`);

  const doRollback = guard(async (targetDeploymentId: string) => {
    await api.rollbackWebsite(workspaceId, websiteId, targetDeploymentId);
    setSite(await api.getWebsite(workspaceId, websiteId));
  }, `rollback-${"x"}`);

  // ── Cliente ──────────────────────────────────────────────
  const attachClient = guard(async () => {
    let id = clientId;
    if (clientMode === "new") {
      if (!newClientName.trim() || !newClientEmail.trim()) {
        throw new Error("Nombre y email del cliente son obligatorios.");
      }
      const created = await api.createClient(workspaceId, newClientName.trim(), newClientEmail.trim());
      id = created.clientId;
    }
    if (!id) throw new Error("Elegí un cliente.");
    await api.assignClientToWebsite(workspaceId, websiteId, id);
    setClients(await api.listClients(workspaceId));
    setSite(await api.getWebsite(workspaceId, websiteId));
    setNewClientName("");
    setNewClientEmail("");
  }, "attach-client");

  /** Invita al cliente asignado al portal (demo: devuelve el link para copiar). */
  const inviteAssignedClient = guard(async () => {
    const assigned = clients.find((c) => c.id === site?.clientId) ?? clients.find((c) => c.id === clientId);
    const email = assigned?.email ?? newClientEmail.trim();
    if (!email) throw new Error("Asigná un cliente con email primero.");
    const result = await api.inviteClientToPortal(workspaceId, email);
    if (result.inviteUrl) {
      const absolute = result.inviteUrl.startsWith("http")
        ? result.inviteUrl
        : `${window.location.origin.replace(/:\d+$/, ":3000")}${result.inviteUrl}`;
      await copyText(`invite-${email}`, absolute);
    } else {
      setError(`Invitación enviada a ${email}.`);
    }
  }, "invite-client");

  // ── Suscripciones ────────────────────────────────────────
  const subscribePlan = guard(async (kind: "HOSTING" | "MAINTENANCE") => {
    const planId = kind === "HOSTING" ? hostingPlanId : tierPlanId;
    if (!planId) throw new Error("Elegí un plan primero.");
    // Use the id returned by creation — component state is still stale here.
    const created = await api.createSubscription(workspaceId, websiteId, planId);
    const checkout = await api.createCheckoutLink(workspaceId, websiteId, created.subscriptionId);
    await copyText(`checkout-${kind}`, checkout.checkoutUrl);
    await refresh();
    await reloadAllowance();
  }, `subscribe-${"x"}`);

  function generateCheckoutFor(kind: "HOSTING" | "MAINTENANCE") {
    const sub = kind === "HOSTING" ? hostingSub : tierSub;
    if (!sub) throw new Error("Primero creá la suscripción.");
    return api.createCheckoutLink(workspaceId, websiteId, sub.id).then((r) => r.checkoutUrl);
  }

  const copyCheckout = guard(async (kind: "HOSTING" | "MAINTENANCE") => {
    const url = await generateCheckoutFor(kind);
    await copyText(`checkout-${kind}`, url);
  }, `checkout-${"x"}`);

  // ── Cobros únicos ────────────────────────────────────────
  const createOneTimeCharge = guard(async () => {
    if (!chargeTitle.trim() || !chargePrice.trim()) throw new Error("Título y monto son obligatorios.");
    const result = await api.createCharge(workspaceId, websiteId, chargeTitle.trim(), chargePrice.trim());
    setCharges(await api.listCharges(workspaceId, websiteId));
    setChargeTitle("");
    setChargePrice("");
    await copyText(`charge-${result.chargeId}`, result.checkoutUrl);
  }, "create-charge");

  const cancelChargeById = guard(async (chargeId: string) => {
    await api.cancelCharge(workspaceId, websiteId, chargeId);
    setCharges(await api.listCharges(workspaceId, websiteId));
  }, `cancel-charge-${"x"}`);

  // ── Mantenimiento (acciones staff) ───────────────────────
  async function requestAction(action: "quote" | "start" | "complete" | "approve" | "mark-paid", requestId: string) {
    setBusy(`req-${requestId}`);
    setError(null);
    try {
      if (action === "quote") {
        const priceDecimal = window.prompt("Monto a cotizar (ej: 50.00)", "50.00");
        if (!priceDecimal) return;
        await api.quoteRequest(workspaceId, websiteId, requestId, priceDecimal);
      } else if (action === "start") await api.startRequest(workspaceId, websiteId, requestId);
      else if (action === "complete") await api.completeRequest(workspaceId, websiteId, requestId);
      else if (action === "approve") await api.approveRequest(workspaceId, websiteId, requestId);
      else if (action === "mark-paid") await api.markPaidRequest(workspaceId, websiteId, requestId);
      setRequests(await api.listMaintenanceRequests(workspaceId, websiteId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "La acción falló.");
    } finally {
      setBusy(null);
    }
  }

  if (error && !site) {
    return <main className={styles.page}><p className={styles.error}>{error}</p></main>;
  }
  if (!site) {
    return <main className={styles.page}><p className={styles.loading}>Abriendo el sitio…</p></main>;
  }

  const plansByKind = (kind: PlanDetail["kind"]) => plans.filter((p) => p.kind === kind && p.active);

  function subscriptionCard(
    title: string,
    sub: SubscriptionDetail | null,
    planOptions: PlanDetail[],
    planId: string,
    setPlanId: (v: string) => void,
    kind: "HOSTING" | "MAINTENANCE",
    extra?: React.ReactNode
  ) {
    return (
      <div className={styles.subCard}>
        <h3 className={styles.subTitle}>{title}</h3>
        {sub ? (
          <>
            <dl className={styles.kv}>
              <div><dt>Estado</dt><dd>{sub.status}</dd></div>
              <div><dt>Precio</dt><dd className={styles.mono}>{sub.priceDecimal} {sub.currency}/{sub.billingInterval === "MONTHLY" ? "mes" : "año"}</dd></div>
              <div><dt>Próxima renovación</dt><dd>{sub.nextBillingDate ? new Date(sub.nextBillingDate).toLocaleDateString("es") : "—"}</dd></div>
            </dl>
            {sub.status !== "ACTIVE" && sub.status !== "CANCELED" && sub.status !== "EXPIRED" && (
              <button
                className={`${btnPrimary} ${styles.wide}`}
                disabled={busy === `checkout-${kind}`}
                onClick={() => copyCheckout(kind)}
              >
                {copiedKey === `checkout-${kind}` ? "¡Link copiado!" : busy === `checkout-${kind}` ? "Generando…" : "Generar y copiar link de pago"}
              </button>
            )}
          </>
        ) : (
          <div className={formRow}>
            <Field label="Plan">
              <select className={selectClass} value={planId} onChange={(e) => setPlanId(e.target.value)}>
                <option value="">Elegí un plan…</option>
                {planOptions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} — {p.priceDecimal} {p.currency}/{p.billingInterval === "MONTHLY" ? "mes" : "año"}
                    {p.kind === "MAINTENANCE" ? (p.includedRequestQuota === null ? " · ilimitado" : ` · ${p.includedRequestQuota} cambios/mes`) : ""}
                  </option>
                ))}
              </select>
            </Field>
            <button className={btnPrimary} disabled={busy === `subscribe-${kind}`} onClick={() => subscribePlan(kind)}>
              {busy === `subscribe-${kind}` ? "…" : "Suscribir + copiar link"}
            </button>
          </div>
        )}
        {extra}
      </div>
    );
  }

  return (
    <>
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <Link href={`/workspaces/${workspaceId}/sitios`} className={styles.back}>← Sitios</Link>
          <h1 className={styles.title}>{site.name}</h1>
          <StatusChip status={site.status} />
        </div>
        <span className={styles.monoDim}>{site.subdomain}.sitedock.app</span>
      </header>

      {error && <p className={styles.error}>{error}</p>}

      <div className={styles.grid}>
        {/* ── Deploy & versiones ── */}
        <section className={`${styles.panel} ${styles.span2}`} aria-label="Deploy">
          <h2 className={styles.panelTitle}>Deploy &amp; versiones</h2>

          <div
            className={styles.dropzone}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const file = e.dataTransfer.files[0];
              if (file) uploadZip(file);
            }}
          >
            <input
              id="zip-input"
              type="file"
              accept=".zip"
              className={styles.fileInput}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) uploadZip(file);
                e.target.value = "";
              }}
            />
            <label htmlFor="zip-input" className={styles.dropLabel}>
              {busy === "upload" ? "Subiendo…" : "Arrastrá tu ZIP acá o hacé click para elegirlo"}
            </label>
          </div>

          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Versión</th>
                <th scope="col">Estado</th>
                <th scope="col">Creado</th>
                <th scope="col" aria-label="Acciones" />
              </tr>
            </thead>
            <tbody>
              {deployments.length === 0 && (
                <tr><td colSpan={4} className={styles.emptyCell}>Sin deployments todavía — subí tu primer ZIP arriba.</td></tr>
              )}
              {deployments.map((d) => {
                const isProduction = site.productionDeploymentId === d.id;
                return (
                  <tr key={d.id}>
                    <td className={styles.mono}>v{d.version}{isProduction && <span className={styles.prodTag}>producción</span>}</td>
                    <td>{d.status}</td>
                    <td className={styles.dim}>{new Date(d.createdAt).toLocaleString("es")}</td>
                    <td className={styles.actions}>
                      {(d.status === "READY" || d.status === "PUBLISHED") && !isProduction && (
                        <button className={btnGhost} disabled={!!busy} onClick={() => doRollback(d.id)} title="Restaurar esta versión como producción">
                          Rollback aquí
                        </button>
                      )}
                      {(d.status === "READY" || d.status === "QUEUED" || d.status === "BUILDING") && (
                        <button className={btnPrimary} disabled={!!busy} onClick={() => doPublish(d.id)}>
                          {busy?.startsWith("publish") ? "…" : d.status === "READY" ? "Publicar" : "Forzar publicación"}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

        {/* ── Cliente ── */}
        <section className={styles.panel} aria-label="Cliente">
          <h2 className={styles.panelTitle}>Cliente</h2>
          {site.clientId ? (
            (() => {
              const assigned = clients.find((c) => c.id === site.clientId);
              return (
                <div className={styles.kvBlock}>
                  <strong>{assigned?.fullName ?? "Cliente asignado"}</strong>
                  <span className={styles.dim}>{assigned?.email}</span>
                  {copiedKey?.startsWith("invite-") ? (
                    <span className={styles.inviteCopied}>¡Link de invitación copiado!</span>
                  ) : (
                    <button className={btnGhost} disabled={busy === "invite-client"} onClick={() => inviteAssignedClient()}>
                      Invitar al portal
                    </button>
                  )}
                </div>
              );
            })()
          ) : (
            <>
              <div className={formRow}>
                <select className={selectClass} value={clientMode} onChange={(e) => setClientMode(e.target.value as "pick" | "new")} aria-label="Modo de cliente">
                  <option value="new">Nuevo cliente…</option>
                  {clients.length > 0 && <option value="pick">Existente</option>}
                </select>
              </div>
              {clientMode === "new" ? (
                <Field label="Datos del cliente">
                  <div className={styles.stack}>
                    <input className={inputClass} placeholder="Nombre completo" value={newClientName} onChange={(e) => setNewClientName(e.target.value)} />
                    <input className={inputClass} placeholder="email@cliente.com" type="email" value={newClientEmail} onChange={(e) => setNewClientEmail(e.target.value)} />
                  </div>
                </Field>
              ) : (
                <Field label="Elegir cliente">
                  <select className={selectClass} value={clientId} onChange={(e) => setClientId(e.target.value)}>
                    <option value="">Elegí…</option>
                    {clients.map((c) => (
                      <option key={c.id} value={c.id}>{c.fullName} ({c.email})</option>
                    ))}
                  </select>
                </Field>
              )}
              <button className={btnPrimary} disabled={busy === "attach-client"} onClick={() => attachClient()}>
                {busy === "attach-client" ? "Asignando…" : "Asignar al sitio"}
              </button>
            </>
          )}
        </section>

        {/* ── Monetización ── */}
        <section className={`${styles.panel} ${styles.span2}`} aria-label="Monetización">
          <h2 className={styles.panelTitle}>Monetización recurrente</h2>
          <div className={styles.twoCols}>
            {subscriptionCard(
              "Hosting + infraestructura",
              hostingSub,
              plansByKind("HOSTING"),
              hostingPlanId,
              setHostingPlanId,
              "HOSTING"
            )}
            {subscriptionCard(
              "Mantenimiento (tier)",
              tierSub,
              plansByKind("MAINTENANCE"),
              tierPlanId,
              setTierPlanId,
              "MAINTENANCE",
              allowance && allowance.hasMembership ? (
                <p className={styles.allowanceLine}>
                  {allowance.quotaIncluded === null
                    ? "Cambios ilimitados incluidos."
                    : `${allowance.usedThisPeriod}/${allowance.quotaIncluded} usadas este período${allowance.remaining !== null ? ` — quedan ${allowance.remaining}` : ""}`}
                </p>
              ) : undefined
            )}
          </div>
        </section>

        {/* ── Cobros únicos ── */}
        <section className={styles.panel} aria-label="Cobros únicos">
          <h2 className={styles.panelTitle}>Cobro único (proyecto)</h2>
          <div className={styles.stack}>
            <input className={inputClass} placeholder='Ej: "Diseño y desarrollo inicial"' value={chargeTitle} onChange={(e) => setChargeTitle(e.target.value)} />
            <input className={inputClass} placeholder="1500.00" inputMode="decimal" value={chargePrice} onChange={(e) => setChargePrice(e.target.value)} />
            <button className={btnPrimary} disabled={busy === "create-charge"} onClick={() => createOneTimeCharge()}>
              {copiedKey?.startsWith("charge-") ? "¡Creado y link copiado!" : busy === "create-charge" ? "Creando…" : "Crear cobro + copiar link"}
            </button>
          </div>
          {charges.length > 0 && (
            <ul className={styles.miniList}>
              {charges.map((c) => (
                <li key={c.id} className={styles.chargeRow}>
                  <span>{c.title}</span>
                  <span className={`${styles.badge} ${styles[`chg-${c.status.toLowerCase()}`]}`}>
                    {c.status === "PAID" ? "Pagado" : c.status === "PENDING" ? "Pendiente" : "Cancelado"}
                  </span>
                  <span className={`${styles.mono} ${styles.right}`}>
                    {moneyFromDecimal(c.amountDecimal, c.currency)}
                  </span>
                  {c.status === "PENDING" && (
                    <button className={styles.linkBtn} disabled={busy === `cancel-charge-${c.id}`} onClick={() => cancelChargeById(c.id)}>
                      Cancelar
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ── Mantenimiento ── */}
        <section className={`${styles.panel} ${styles.span2}`} aria-label="Solicitudes de mantenimiento">
          <h2 className={styles.panelTitle}>Solicitudes de mantenimiento</h2>
          {requests.length === 0 ? (
            <p className={styles.empty}>Sin solicitudes. Tu cliente puede pedir cambios desde su portal.</p>
          ) : (
            <ul className={styles.reqList}>
              {requests.map((r) => (
                <li key={r.id} className={styles.reqItem}>
                  <div className={styles.reqHead}>
                    <strong>{r.title}</strong>
                    <span className={styles.badge}>{REQ_STATUS[r.status]}</span>
                  </div>
                  <p className={styles.reqDesc}>{r.description}</p>
                  {r.priceCents !== null && (
                    <p className={`${styles.mono} ${styles.dim}`}>{money(r.priceCents, r.currency ?? "USD")}</p>
                  )}
                  <div className={styles.reqActions}>
                    {r.status === "OPEN" && (
                      <>
                        <button className={btnGhost} disabled={busy === `req-${r.id}`} onClick={() => requestAction("quote", r.id)}>Cotizar</button>
                        <button className={btnPrimary} disabled={busy === `req-${r.id}`} onClick={() => requestAction("start", r.id)}>Iniciar</button>
                      </>
                    )}
                    {(r.status === "PAID" || r.status === "IN_PROGRESS") && (
                      <button className={btnPrimary} disabled={busy === `req-${r.id}`} onClick={() => requestAction("complete", r.id)}>Completar</button>
                    )}
                    {r.status === "PENDING_PAYMENT" && (
                      <button className={btnPrimary} disabled={busy === `req-${r.id}`} onClick={() => requestAction("mark-paid", r.id)}>Marcar pagada</button>
                    )}
                    {r.status === "COMPLETED" && (
                      <button className={btnGhost} disabled={busy === `req-${r.id}`} onClick={() => requestAction("approve", r.id)}>Aprobar por el cliente</button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
