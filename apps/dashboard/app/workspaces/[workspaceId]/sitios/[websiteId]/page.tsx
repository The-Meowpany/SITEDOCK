"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/lib/api-client";
import type {
  ChargeSummary,
  ClientSummary,
  DeploymentSummary,
  DomainDetail,
  DomainListResponse,
  GitHubConnection,
  GitHubRepository,
  MaintenanceRequestSummary,
  PlanDetail,
  ServiceSummary,
  SubscriptionDetail,
  WebsiteSummary,
} from "@/lib/api-client";
import { ApiError } from "@/lib/api-error";
import { money, moneyFromDecimal } from "@/lib/format";
import { siteHostname } from "@/lib/site-domain";
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

const DOMAIN_STATUS: Record<DomainDetail["status"], string> = {
  PENDING: "Pendiente",
  VERIFYING: "Verificando",
  VERIFIED: "Verificado",
  FAILED: "Falló",
};

const SSL_STATUS: Record<DomainDetail["sslStatus"], string> = {
  NONE: "Sin certificado",
  PENDING: "Emitiendo",
  ISSUED: "Activo",
  FAILED: "Error",
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
  const [domainData, setDomainData] = useState<DomainListResponse>({
    provider: "manual",
    managed: false,
    domains: [],
  });
  const [services, setServices] = useState<ServiceSummary[]>([]);
  const [githubConnections, setGithubConnections] = useState<GitHubConnection[]>([]);
  const [githubInstallationId, setGithubInstallationId] = useState("");
  const [githubRepos, setGithubRepos] = useState<GitHubRepository[]>([]);
  const [githubRepoId, setGithubRepoId] = useState("");
  const [githubServiceId, setGithubServiceId] = useState("");
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
  const [domainHostname, setDomainHostname] = useState("");
  const [domainServiceId, setDomainServiceId] = useState("");
  const [domainAutoManage, setDomainAutoManage] = useState(false);

  const refresh = useCallback(async () => {
    const siteData = await api.getWebsite(workspaceId, websiteId);
    const [
      deploymentsData,
      clientsData,
      plansData,
      hostingSubData,
      tierSubData,
      requestsData,
      chargesData,
      allowanceData,
      domainsData,
      servicesData,
      githubData,
    ] = await Promise.all([
      api.listDeployments(workspaceId, websiteId),
      api.listClients(workspaceId),
      api.listPlans(workspaceId),
      api.getSubscription(workspaceId, websiteId, "HOSTING"),
      api.getSubscription(workspaceId, websiteId, "MAINTENANCE"),
      api.listMaintenanceRequests(workspaceId, websiteId).catch(() => [] as MaintenanceRequestSummary[]),
      api.listCharges(workspaceId, websiteId).catch(() => [] as ChargeSummary[]),
      api.getAllowance(workspaceId, websiteId).catch(() => null),
      api.listDomains(workspaceId, websiteId).catch(
        () => ({ provider: "manual", managed: false, domains: [] }) as DomainListResponse
      ),
      siteData.projectId
        ? api.listServices(workspaceId, siteData.projectId).catch(() => [] as ServiceSummary[])
        : Promise.resolve([] as ServiceSummary[]),
      api.listGitHubConnections(workspaceId, websiteId).catch(() => [] as GitHubConnection[]),
    ]);
    setSite(siteData);
    setDeployments(deploymentsData);
    setClients(clientsData);
    setPlans(plansData);
    setHostingSub(hostingSubData);
    setTierSub(tierSubData);
    setRequests(requestsData);
    setCharges(chargesData);
    setDomainData(domainsData);
    setServices(servicesData);
    setGithubConnections(githubData);
    return allowanceData;
  }, [workspaceId, websiteId]);

  const [allowance, setAllowance] = useState<Awaited<ReturnType<typeof api.getAllowance>> | null>(null);

  async function loadGitHubRepos(installationId = githubInstallationId) {
    const id = installationId.trim();
    if (!/^\d{1,20}$/.test(id)) {
      setError("Pegá el installation ID numérico que devolvió GitHub.");
      return;
    }
    setBusy("github-repos");
    setError(null);
    try {
      const result = await api.listGitHubRepositories(workspaceId, websiteId, id);
      setGithubRepos(result.repositories);
      setGithubRepoId((current) =>
        result.repositories.some((repo) => repo.id === current) ? current : result.repositories[0]?.id ?? ""
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos listar los repositorios.");
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const installationId = query.get("installation_id");
    if (!installationId) return;
    setGithubInstallationId(installationId);
    void loadGitHubRepos(installationId);
    window.history.replaceState({}, "", window.location.pathname);
  }, []);

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

  // ── Dominios ─────────────────────────────────────────────
  async function reloadDomains() {
    setDomainData(await api.listDomains(workspaceId, websiteId));
  }

  const connectDomain = guard(async () => {
    const hostname = domainHostname.trim();
    if (!hostname) throw new Error("Escribí el dominio que querés conectar.");
    await api.registerDomain(workspaceId, websiteId, hostname, {
      serviceId: domainServiceId || null,
      autoManage: domainAutoManage,
    });
    setDomainHostname("");
    setDomainServiceId("");
    setDomainAutoManage(false);
    await reloadDomains();
  }, "domain-connect");

  const verifyDomainById = guard(async (domainId: string) => {
    const result = await api.verifyDomain(workspaceId, websiteId, domainId);
    await reloadDomains();
    if (!result.verified) {
      throw new Error(result.message ?? "El registro de propiedad todavía no es visible en DNS.");
    }
    if (result.sslStatus === "FAILED") {
      throw new Error(result.message ?? "El dominio está verificado, pero el certificado aún no está disponible.");
    }
  }, "domain-verify");

  const checkDomainById = guard(async (domainId: string) => {
    const result = await api.checkDomain(workspaceId, websiteId, domainId);
    await reloadDomains();
    if (result.sslStatus === "FAILED") {
      throw new Error(result.message ?? "El certificado todavía no está disponible.");
    }
  }, "domain-check");

  const removeDomainById = guard(async (domainId: string, hostname: string) => {
    if (!window.confirm(`¿Desconectar ${hostname} de este sitio?`)) return;
    await api.deleteDomain(workspaceId, websiteId, domainId);
    await reloadDomains();
  }, "domain-delete");

  // ── GitHub ───────────────────────────────────────────────
  const connectGitHubRepo = guard(async () => {
    const repo = githubRepos.find((candidate) => candidate.id === githubRepoId);
    if (!repo) throw new Error("Elegí un repositorio de la instalación.");
    await api.connectGitHub(workspaceId, websiteId, {
      installationId: githubInstallationId.trim(),
      repositoryId: repo.id,
      repositoryFullName: repo.fullName,
      serviceId: githubServiceId || null,
    });
    setGithubConnections(await api.listGitHubConnections(workspaceId, websiteId));
    setGithubInstallationId("");
    setGithubRepos([]);
    setGithubRepoId("");
    setGithubServiceId("");
  }, "github-connect");

  const disconnectGitHubRepo = guard(async (connectionId: string, repositoryFullName: string) => {
    if (!window.confirm(`¿Desconectar ${repositoryFullName}?`)) return;
    await api.disconnectGitHub(workspaceId, websiteId, connectionId);
    setGithubConnections(await api.listGitHubConnections(workspaceId, websiteId));
  }, "github-disconnect");

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
        <span className={styles.monoDim}>{siteHostname(site.subdomain)}</span>
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

        {/* ── Dominios ── */}
        <section className={`${styles.panel} ${styles.span2}`} aria-label="Dominios">
          <div className={styles.domainTitleRow}>
            <h2 className={styles.panelTitle}>Dominios</h2>
            <span className={styles.domainProvider}>
              {domainData.provider === "dnshe" ? "DNSHE" : domainData.provider} ·{" "}
              {domainData.managed ? "DNS gestionado" : "DNS manual"}
            </span>
          </div>
          <p className={styles.dim}>
            Conectá un dominio propio. Primero publicás un TXT de propiedad; después apuntás el
            tráfico al edge y SiteDock emite el certificado automáticamente.
          </p>

          <div className={styles.domainForm}>
            <input
              className={inputClass}
              placeholder="midominio.com"
              value={domainHostname}
              onChange={(e) => setDomainHostname(e.target.value)}
              aria-label="Dominio a conectar"
            />
            <select
              className={selectClass}
              value={domainServiceId}
              onChange={(e) => setDomainServiceId(e.target.value)}
              aria-label="Servicio destino"
            >
              <option value="">Sitio estático (por defecto)</option>
              {services.map((service) => (
                <option key={service.id} value={service.id}>
                  {service.name} · {service.hostname} ({service.status})
                </option>
              ))}
            </select>
            <button className={btnPrimary} disabled={busy === "domain-connect"} onClick={() => connectDomain()}>
              {busy === "domain-connect" ? "Conectando…" : "Conectar dominio"}
            </button>
          </div>
          {domainData.managed && (
            <label className={styles.checkLine}>
              <input
                type="checkbox"
                checked={domainAutoManage}
                onChange={(e) => setDomainAutoManage(e.target.checked)}
              />
              Crear el registro TXT automáticamente si el dominio está en la cuenta DNSHE
            </label>
          )}

          {domainData.domains.length === 0 ? (
            <p className={styles.empty}>Todavía no hay dominios conectados.</p>
          ) : (
            <ul className={styles.domainList}>
              {domainData.domains.map((domain) => {
                const targetService = domain.serviceId
                  ? services.find((s) => s.id === domain.serviceId)
                  : null;
                return (
                  <li key={domain.id} className={styles.domainItem}>
                    <div className={styles.domainHead}>
                      <strong className={styles.mono}>{domain.hostname}</strong>
                      <span className={`${styles.badge} ${domain.status === "VERIFIED" ? styles.domainOk : ""}`}>
                        {DOMAIN_STATUS[domain.status]}
                      </span>
                      <span className={styles.dim}>
                        {targetService ? `→ ${targetService.name}` : "→ sitio estático"}
                      </span>
                      {domain.autoManaged && <span className={styles.domainProvider}>auto</span>}
                    </div>

                    {domain.lastError && <p className={styles.domainError}>{domain.lastError}</p>}

                    <div className={styles.domainMeta}>
                      <span>DNS: {domain.routingOk ? "apunta al edge" : "pendiente"}</span>
                      <span>SSL: {SSL_STATUS[domain.sslStatus]}</span>
                      {domain.sslExpiresAt && (
                        <span>Vence: {new Date(domain.sslExpiresAt).toLocaleDateString("es")}</span>
                      )}
                    </div>

                    {domain.dnsRecord.name && domain.dnsRecord.value && domain.status !== "VERIFIED" && (
                      <div className={styles.dnsBox}>
                        <span className={styles.dnsLabel}>Propiedad</span>
                        <code className={styles.dnsValue}>
                          {domain.dnsRecord.type} {domain.dnsRecord.name} → {domain.dnsRecord.value}
                        </code>
                        <button
                          className={styles.linkBtn}
                          onClick={() =>
                            copyText(`txt-${domain.id}`, `${domain.dnsRecord.name} ${domain.dnsRecord.value}`)
                          }
                        >
                          {copiedKey === `txt-${domain.id}` ? "¡Copiado!" : "Copiar"}
                        </button>
                      </div>
                    )}

                    {domain.instructions && (
                      <div className={styles.dnsBox}>
                        <span className={styles.dnsLabel}>Tráfico</span>
                        <code className={styles.dnsValue}>
                          {domain.instructions.recordType} {domain.instructions.recordName} →{" "}
                          {domain.instructions.recordValue}
                        </code>
                        <button
                          className={styles.linkBtn}
                          onClick={() =>
                            copyText(
                              `route-${domain.id}`,
                              `${domain.instructions!.recordName} ${domain.instructions!.recordValue}`
                            )
                          }
                        >
                          {copiedKey === `route-${domain.id}` ? "¡Copiado!" : "Copiar"}
                        </button>
                      </div>
                    )}

                    <div className={styles.domainActions}>
                      {domain.status !== "VERIFIED" ? (
                        <button
                          className={btnPrimary}
                          disabled={busy === "domain-verify"}
                          onClick={() => verifyDomainById(domain.id)}
                        >
                          {busy === "domain-verify" ? "Comprobando…" : "Verificar propiedad"}
                        </button>
                      ) : (
                        <button
                          className={btnGhost}
                          disabled={busy === "domain-check"}
                          onClick={() => checkDomainById(domain.id)}
                        >
                          {busy === "domain-check" ? "Comprobando…" : "Comprobar DNS + SSL"}
                        </button>
                      )}
                      <button
                        className={styles.linkBtn}
                        disabled={busy === "domain-delete"}
                        onClick={() => removeDomainById(domain.id, domain.hostname)}
                      >
                        Desconectar
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* ── GitHub ── */}
        <section className={`${styles.panel} ${styles.span2}`} aria-label="GitHub">
          <div className={styles.domainTitleRow}>
            <h2 className={styles.panelTitle}>GitHub</h2>
            <span className={styles.domainProvider}>GitHub App</span>
          </div>
          <p className={styles.dim}>
            Conectá un repositorio para publicar desde GitHub: los pushes a la rama principal
            despliegan producción y las pull requests generan previews.
          </p>

          <div className={styles.domainForm}>
            {process.env.NEXT_PUBLIC_GITHUB_APP_SLUG ? (
              <a
                className={btnPrimary}
                href={`https://github.com/apps/${process.env.NEXT_PUBLIC_GITHUB_APP_SLUG}/installations/new?state=${encodeURIComponent(`${workspaceId}:${websiteId}`)}`}
              >
                Instalar GitHub App
              </a>
            ) : (
              <span className={styles.dim}>Configurá NEXT_PUBLIC_GITHUB_APP_SLUG para habilitar la instalación.</span>
            )}
            <input
              className={inputClass}
              placeholder="Installation ID (si ya instalaste la app)"
              value={githubInstallationId}
              onChange={(e) => setGithubInstallationId(e.target.value)}
              inputMode="numeric"
              aria-label="GitHub installation ID"
            />
            <button
              className={btnGhost}
              disabled={busy === "github-repos"}
              onClick={() => loadGitHubRepos()}
            >
              {busy === "github-repos" ? "Cargando…" : "Ver repositorios"}
            </button>
          </div>

          {githubRepos.length > 0 && (
            <div className={styles.domainForm}>
              <select
                className={selectClass}
                value={githubRepoId}
                onChange={(e) => setGithubRepoId(e.target.value)}
                aria-label="Repositorio"
              >
                {githubRepos.map((repo) => (
                  <option key={repo.id} value={repo.id}>
                    {repo.fullName}{repo.private ? " · privado" : ""}
                  </option>
                ))}
              </select>
              <select
                className={selectClass}
                value={githubServiceId}
                onChange={(e) => setGithubServiceId(e.target.value)}
                aria-label="Servicio a desplegar"
              >
                <option value="">Sitio estático (por defecto)</option>
                {services.map((service) => (
                  <option key={service.id} value={service.id}>
                    {service.name} · {service.hostname}
                  </option>
                ))}
              </select>
              <button
                className={btnPrimary}
                disabled={busy === "github-connect"}
                onClick={() => connectGitHubRepo()}
              >
                {busy === "github-connect" ? "Conectando…" : "Conectar repositorio"}
              </button>
            </div>
          )}

          {githubConnections.length === 0 ? (
            <p className={styles.empty}>Todavía no hay repositorios conectados.</p>
          ) : (
            <ul className={styles.domainList}>
              {githubConnections.map((connection) => {
                const targetServices = connection.serviceId
                  ? services.find((service) => service.id === connection.serviceId)
                  : null;
                return (
                  <li key={connection.id} className={styles.domainItem}>
                    <div className={styles.domainHead}>
                      <strong className={styles.mono}>{connection.repositoryFullName}</strong>
                      <span className={`${styles.badge} ${styles.domainOk}`}>Conectado</span>
                      <span className={styles.dim}>
                        rama {connection.defaultBranch} · {targetServices ? targetServices.name : "sitio estático"}
                      </span>
                    </div>
                    <div className={styles.domainActions}>
                      <button
                        className={styles.linkBtn}
                        disabled={busy === "github-disconnect"}
                        onClick={() => disconnectGitHubRepo(connection.id, connection.repositoryFullName)}
                      >
                        Desconectar
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
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
        {r.status === "PAID" && (
          <button className={btnPrimary} disabled={busy === `req-${r.id}`} onClick={() => requestAction("start", r.id)}>Iniciar</button>
        )}
        {r.status === "IN_PROGRESS" && (
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
