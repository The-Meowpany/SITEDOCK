"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
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
import { useI18n } from "@/lib/i18n";
import type { MessageKey, TranslateParams } from "@/lib/i18n";
import { siteHostname } from "@/lib/site-domain";
import { StatusChip } from "@/components/StatusChip";
import { Field, btnGhost, btnPrimary, formRow, inputClass, selectClass } from "@/components/ui";
import styles from "./page.module.css";

const REQ_STATUS_KEY: Record<MaintenanceRequestSummary["status"], MessageKey> = {
  OPEN: "req.status.OPEN",
  IN_PROGRESS: "req.status.IN_PROGRESS",
  WAITING_CLIENT: "req.status.WAITING_CLIENT",
  PENDING_PAYMENT: "req.status.PENDING_PAYMENT",
  PAID: "req.status.PAID",
  COMPLETED: "req.status.COMPLETED",
  APPROVED: "req.status.APPROVED",
  CANCELED: "req.status.CANCELED",
};

const DOMAIN_STATUS_KEY: Record<DomainDetail["status"], MessageKey> = {
  PENDING: "domain.status.PENDING",
  VERIFYING: "domain.status.VERIFYING",
  VERIFIED: "domain.status.VERIFIED",
  FAILED: "domain.status.FAILED",
};

const SSL_STATUS_KEY: Record<DomainDetail["sslStatus"], MessageKey> = {
  NONE: "ssl.status.NONE",
  PENDING: "ssl.status.PENDING",
  ISSUED: "ssl.status.ISSUED",
  FAILED: "ssl.status.FAILED",
};

const CHARGE_STATUS_KEY: Record<ChargeSummary["status"], MessageKey> = {
  PAID: "charge.status.PAID",
  PENDING: "charge.status.PENDING",
  CANCELED: "charge.status.CANCELED",
};

export default function SiteConsolePage() {
  const params = useParams<{ workspaceId: string; websiteId: string }>();
  const router = useRouter();
  const { t, formatDate, formatDateTime } = useI18n();
  // Always-current translator for async code and effects, so a locale change never re-triggers data loading.
  const tRef = useRef(t);
  tRef.current = t;
  const tt = (key: MessageKey, params?: TranslateParams) => tRef.current(key, params);
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
      setError(tt("site.github.invalidInstallation"));
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
      setError(err instanceof Error ? err.message : tt("site.github.listError"));
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
        setError(err instanceof Error ? err.message : tt("site.loadError"));
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
        setError(err instanceof Error ? err.message : tt("site.actionFailed"));
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

  // ── Deploy & versions ───────────────────────────────────
  const uploadZip = guard(async (file: File) => {
    await api.uploadDeployment(workspaceId, websiteId, file);
    setDeployments(await api.listDeployments(workspaceId, websiteId));
    setSite(await api.getWebsite(workspaceId, websiteId));
  }, "upload");

  /** Publishes by chaining submit→approve→publish, tolerating already-completed transitions. */
  async function fullPublish(deploymentId: string) {
    for (const step of [
      () => api.submitForApproval(workspaceId, websiteId),
      () => api.approveWebsite(workspaceId, websiteId),
      () => api.publishDeployment(workspaceId, websiteId, deploymentId),
    ]) {
      await step().catch(() => undefined); // transitions already applied are not errors here
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

  // ── Client ───────────────────────────────────────────────
  const attachClient = guard(async () => {
    let id = clientId;
    if (clientMode === "new") {
      if (!newClientName.trim() || !newClientEmail.trim()) {
        throw new Error(tt("site.client.required"));
      }
      const created = await api.createClient(workspaceId, newClientName.trim(), newClientEmail.trim());
      id = created.clientId;
    }
    if (!id) throw new Error(tt("site.client.pick"));
    await api.assignClientToWebsite(workspaceId, websiteId, id);
    setClients(await api.listClients(workspaceId));
    setSite(await api.getWebsite(workspaceId, websiteId));
    setNewClientName("");
    setNewClientEmail("");
  }, "attach-client");

  /** Invites the assigned client to the portal (demo: returns the link to copy). */
  const inviteAssignedClient = guard(async () => {
    const assigned = clients.find((c) => c.id === site?.clientId) ?? clients.find((c) => c.id === clientId);
    const email = assigned?.email ?? newClientEmail.trim();
    if (!email) throw new Error(tt("site.client.needEmail"));
    const result = await api.inviteClientToPortal(workspaceId, email);
    if (result.inviteUrl) {
      const absolute = result.inviteUrl.startsWith("http")
        ? result.inviteUrl
        : `${window.location.origin.replace(/:\d+$/, ":3000")}${result.inviteUrl}`;
      await copyText(`invite-${email}`, absolute);
    } else {
      setError(tt("site.client.inviteSent", { email }));
    }
  }, "invite-client");

  // ── Subscriptions ────────────────────────────────────────
  const subscribePlan = guard(async (kind: "HOSTING" | "MAINTENANCE") => {
    const planId = kind === "HOSTING" ? hostingPlanId : tierPlanId;
    if (!planId) throw new Error(tt("site.sub.pickPlan"));
    // Use the id returned by creation — component state is still stale here.
    const created = await api.createSubscription(workspaceId, websiteId, planId);
    const checkout = await api.createCheckoutLink(workspaceId, websiteId, created.subscriptionId);
    await copyText(`checkout-${kind}`, checkout.checkoutUrl);
    await refresh();
    await reloadAllowance();
  }, `subscribe-${"x"}`);

  function generateCheckoutFor(kind: "HOSTING" | "MAINTENANCE") {
    const sub = kind === "HOSTING" ? hostingSub : tierSub;
    if (!sub) throw new Error(tt("site.sub.createFirst"));
    return api.createCheckoutLink(workspaceId, websiteId, sub.id).then((r) => r.checkoutUrl);
  }

  const copyCheckout = guard(async (kind: "HOSTING" | "MAINTENANCE") => {
    const url = await generateCheckoutFor(kind);
    await copyText(`checkout-${kind}`, url);
  }, `checkout-${"x"}`);

  // ── One-time charges ────────────────────────────────────────
  const createOneTimeCharge = guard(async () => {
    if (!chargeTitle.trim() || !chargePrice.trim()) throw new Error(tt("site.charge.required"));
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

  // ── Maintenance (staff actions) ──────────────────────────
  async function requestAction(action: "quote" | "start" | "complete" | "approve" | "mark-paid", requestId: string) {
    setBusy(`req-${requestId}`);
    setError(null);
    try {
      if (action === "quote") {
        const priceDecimal = window.prompt(tt("site.quote.prompt"), "50.00");
        if (!priceDecimal) return;
        await api.quoteRequest(workspaceId, websiteId, requestId, priceDecimal);
      } else if (action === "start") await api.startRequest(workspaceId, websiteId, requestId);
      else if (action === "complete") await api.completeRequest(workspaceId, websiteId, requestId);
      else if (action === "approve") await api.approveRequest(workspaceId, websiteId, requestId);
      else if (action === "mark-paid") await api.markPaidRequest(workspaceId, websiteId, requestId);
      setRequests(await api.listMaintenanceRequests(workspaceId, websiteId));
    } catch (err) {
      setError(err instanceof Error ? err.message : tt("site.actionFailed"));
    } finally {
      setBusy(null);
    }
  }

  // ── Domains ──────────────────────────────────────────────
  async function reloadDomains() {
    setDomainData(await api.listDomains(workspaceId, websiteId));
  }

  const connectDomain = guard(async () => {
    const hostname = domainHostname.trim();
    if (!hostname) throw new Error(tt("site.domain.hostnameRequired"));
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
      throw new Error(result.message ?? tt("site.domain.txtNotVisible"));
    }
    if (result.sslStatus === "FAILED") {
      throw new Error(result.message ?? tt("site.domain.sslNotAvailableVerified"));
    }
  }, "domain-verify");

  const checkDomainById = guard(async (domainId: string) => {
    const result = await api.checkDomain(workspaceId, websiteId, domainId);
    await reloadDomains();
    if (result.sslStatus === "FAILED") {
      throw new Error(result.message ?? tt("site.domain.sslNotAvailable"));
    }
  }, "domain-check");

  const removeDomainById = guard(async (domainId: string, hostname: string) => {
    if (!window.confirm(tt("site.domain.confirmDisconnect", { name: hostname }))) return;
    await api.deleteDomain(workspaceId, websiteId, domainId);
    await reloadDomains();
  }, "domain-delete");

  // ── GitHub ───────────────────────────────────────────────
  const connectGitHubRepo = guard(async () => {
    const repo = githubRepos.find((candidate) => candidate.id === githubRepoId);
    if (!repo) throw new Error(tt("site.github.pickRepo"));
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
    if (!window.confirm(tt("site.github.confirmDisconnect", { name: repositoryFullName }))) return;
    await api.disconnectGitHub(workspaceId, websiteId, connectionId);
    setGithubConnections(await api.listGitHubConnections(workspaceId, websiteId));
  }, "github-disconnect");

  if (error && !site) {
    return <main className={styles.page}><p className={styles.error}>{error}</p></main>;
  }
  if (!site) {
    return <main className={styles.page}><p className={styles.loading}>{t("site.opening")}</p></main>;
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
              <div><dt>{t("sub.status")}</dt><dd>{sub.status}</dd></div>
              <div><dt>{t("sub.price")}</dt><dd className={styles.mono}>{sub.priceDecimal} {sub.currency}/{sub.billingInterval === "MONTHLY" ? t("sub.perMonth") : t("sub.perYear")}</dd></div>
              <div><dt>{t("sub.nextRenewal")}</dt><dd>{sub.nextBillingDate ? formatDate(sub.nextBillingDate) : "—"}</dd></div>
            </dl>
            {sub.status !== "ACTIVE" && sub.status !== "CANCELED" && sub.status !== "EXPIRED" && (
              <button
                className={`${btnPrimary} ${styles.wide}`}
                disabled={busy === `checkout-${kind}`}
                onClick={() => copyCheckout(kind)}
              >
                {copiedKey === `checkout-${kind}` ? t("sub.linkCopied") : busy === `checkout-${kind}` ? t("sub.generating") : t("sub.generateLink")}
              </button>
            )}
          </>
        ) : (
          <div className={formRow}>
            <Field label={t("sub.plan")}>
              <select className={selectClass} value={planId} onChange={(e) => setPlanId(e.target.value)}>
                <option value="">{t("sub.pickPlan")}</option>
                {planOptions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} — {p.priceDecimal} {p.currency}/{p.billingInterval === "MONTHLY" ? t("sub.perMonth") : t("sub.perYear")}
                    {p.kind === "MAINTENANCE" ? ` · ${p.includedRequestQuota === null ? t("sub.unlimited") : t("sub.changesPerMonth", { count: p.includedRequestQuota })}` : ""}
                  </option>
                ))}
              </select>
            </Field>
            <button className={btnPrimary} disabled={busy === `subscribe-${kind}`} onClick={() => subscribePlan(kind)}>
              {busy === `subscribe-${kind}` ? "…" : t("sub.subscribe")}
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
          <Link href={`/workspaces/${workspaceId}/sitios`} className={styles.back}>{t("site.back")}</Link>
          <h1 className={styles.title}>{site.name}</h1>
          <StatusChip status={site.status} />
        </div>
        <span className={styles.monoDim}>{siteHostname(site.subdomain)}</span>
      </header>

      {error && <p className={styles.error}>{error}</p>}

      <div className={styles.grid}>
        {/* ── Deploy & versions ── */}
        <section className={`${styles.panel} ${styles.span2}`} aria-label={t("deploy.aria")}>
          <h2 className={styles.panelTitle}>{t("deploy.title")}</h2>

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
              {busy === "upload" ? t("deploy.uploading") : t("deploy.drop")}
            </label>
          </div>

          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">{t("deploy.version")}</th>
                <th scope="col">{t("deploy.status")}</th>
                <th scope="col">{t("deploy.created")}</th>
                <th scope="col" aria-label={t("deploy.actions")} />
              </tr>
            </thead>
            <tbody>
              {deployments.length === 0 && (
                <tr><td colSpan={4} className={styles.emptyCell}>{t("deploy.empty")}</td></tr>
              )}
              {deployments.map((d) => {
                const isProduction = site.productionDeploymentId === d.id;
                return (
                  <tr key={d.id}>
                    <td className={styles.mono}>v{d.version}{isProduction && <span className={styles.prodTag}>{t("deploy.production")}</span>}</td>
                    <td>{d.status}</td>
                    <td className={styles.dim}>{formatDateTime(d.createdAt)}</td>
                    <td className={styles.actions}>
                      {(d.status === "READY" || d.status === "PUBLISHED") && !isProduction && (
                        <button className={btnGhost} disabled={!!busy} onClick={() => doRollback(d.id)} title={t("deploy.rollbackTitle")}>
                          {t("deploy.rollback")}
                        </button>
                      )}
                      {(d.status === "READY" || d.status === "QUEUED" || d.status === "BUILDING") && (
                        <button className={btnPrimary} disabled={!!busy} onClick={() => doPublish(d.id)}>
                          {busy?.startsWith("publish") ? "…" : d.status === "READY" ? t("deploy.publish") : t("deploy.forcePublish")}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

        {/* ── Client ── */}
        <section className={styles.panel} aria-label={t("client.title")}>
          <h2 className={styles.panelTitle}>{t("client.title")}</h2>
          {site.clientId ? (
            (() => {
              const assigned = clients.find((c) => c.id === site.clientId);
              return (
                <div className={styles.kvBlock}>
                  <strong>{assigned?.fullName ?? t("client.assigned")}</strong>
                  <span className={styles.dim}>{assigned?.email}</span>
                  {copiedKey?.startsWith("invite-") ? (
                    <span className={styles.inviteCopied}>{t("client.inviteCopied")}</span>
                  ) : (
                    <button className={btnGhost} disabled={busy === "invite-client"} onClick={() => inviteAssignedClient()}>
                      {t("client.invite")}
                    </button>
                  )}
                </div>
              );
            })()
          ) : (
            <>
              <div className={formRow}>
                <select className={selectClass} value={clientMode} onChange={(e) => setClientMode(e.target.value as "pick" | "new")} aria-label={t("client.modeAria")}>
                  <option value="new">{t("client.new")}</option>
                  {clients.length > 0 && <option value="pick">{t("client.existing")}</option>}
                </select>
              </div>
              {clientMode === "new" ? (
                <Field label={t("client.details")}>
                  <div className={styles.stack}>
                    <input className={inputClass} placeholder={t("client.fullName")} value={newClientName} onChange={(e) => setNewClientName(e.target.value)} />
                    <input className={inputClass} placeholder={t("client.emailPlaceholder")} type="email" value={newClientEmail} onChange={(e) => setNewClientEmail(e.target.value)} />
                  </div>
                </Field>
              ) : (
                <Field label={t("client.choose")}>
                  <select className={selectClass} value={clientId} onChange={(e) => setClientId(e.target.value)}>
                    <option value="">{t("client.choosePlaceholder")}</option>
                    {clients.map((c) => (
                      <option key={c.id} value={c.id}>{c.fullName} ({c.email})</option>
                    ))}
                  </select>
                </Field>
              )}
              <button className={btnPrimary} disabled={busy === "attach-client"} onClick={() => attachClient()}>
                {busy === "attach-client" ? t("client.assigning") : t("client.assign")}
              </button>
            </>
          )}
        </section>

        {/* ── Domains ── */}
        <section className={`${styles.panel} ${styles.span2}`} aria-label={t("domains.title")}>
          <div className={styles.domainTitleRow}>
            <h2 className={styles.panelTitle}>{t("domains.title")}</h2>
            <span className={styles.domainProvider}>
              {domainData.provider === "dnshe" ? "DNSHE" : domainData.provider} ·{" "}
              {domainData.managed ? t("domains.managedDns") : t("domains.manualDns")}
            </span>
          </div>
          <p className={styles.dim}>
            {t("domains.intro")}
          </p>

          <div className={styles.domainForm}>
            <input
              className={inputClass}
              placeholder={t("domains.hostnamePlaceholder")}
              value={domainHostname}
              onChange={(e) => setDomainHostname(e.target.value)}
              aria-label={t("domains.hostnameAria")}
            />
            <select
              className={selectClass}
              value={domainServiceId}
              onChange={(e) => setDomainServiceId(e.target.value)}
              aria-label={t("domains.targetAria")}
            >
              <option value="">{t("domains.staticDefault")}</option>
              {services.map((service) => (
                <option key={service.id} value={service.id}>
                  {service.name} · {service.hostname} ({service.status})
                </option>
              ))}
            </select>
            <button className={btnPrimary} disabled={busy === "domain-connect"} onClick={() => connectDomain()}>
              {busy === "domain-connect" ? t("domains.connecting") : t("domains.connect")}
            </button>
          </div>
          {domainData.managed && (
            <label className={styles.checkLine}>
              <input
                type="checkbox"
                checked={domainAutoManage}
                onChange={(e) => setDomainAutoManage(e.target.checked)}
              />
              {t("domains.autoTxt")}
            </label>
          )}

          {domainData.domains.length === 0 ? (
            <p className={styles.empty}>{t("domains.empty")}</p>
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
                        {t(DOMAIN_STATUS_KEY[domain.status])}
                      </span>
                      <span className={styles.dim}>
                        {targetService ? `→ ${targetService.name}` : t("domains.toStatic")}
                      </span>
                      {domain.autoManaged && <span className={styles.domainProvider}>auto</span>}
                    </div>

                    {domain.lastError && <p className={styles.domainError}>{domain.lastError}</p>}

                    <div className={styles.domainMeta}>
                      <span>{t("domains.dnsState", { state: domain.routingOk ? t("domains.pointsToEdge") : t("domains.pending") })}</span>
                      <span>{t("domains.sslState", { state: t(SSL_STATUS_KEY[domain.sslStatus]) })}</span>
                      {domain.sslExpiresAt && (
                        <span>{t("domains.expiresOn", { date: formatDate(domain.sslExpiresAt) })}</span>
                      )}
                    </div>

                    {domain.dnsRecord.name && domain.dnsRecord.value && domain.status !== "VERIFIED" && (
                      <div className={styles.dnsBox}>
                        <span className={styles.dnsLabel}>{t("domains.ownership")}</span>
                        <code className={styles.dnsValue}>
                          {domain.dnsRecord.type} {domain.dnsRecord.name} → {domain.dnsRecord.value}
                        </code>
                        <button
                          className={styles.linkBtn}
                          onClick={() =>
                            copyText(`txt-${domain.id}`, `${domain.dnsRecord.name} ${domain.dnsRecord.value}`)
                          }
                        >
                          {copiedKey === `txt-${domain.id}` ? t("domains.copied") : t("domains.copy")}
                        </button>
                      </div>
                    )}

                    {domain.instructions && (
                      <div className={styles.dnsBox}>
                        <span className={styles.dnsLabel}>{t("domains.traffic")}</span>
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
                          {copiedKey === `route-${domain.id}` ? t("domains.copied") : t("domains.copy")}
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
                          {busy === "domain-verify" ? t("domains.checking") : t("domains.verifyOwnership")}
                        </button>
                      ) : (
                        <button
                          className={btnGhost}
                          disabled={busy === "domain-check"}
                          onClick={() => checkDomainById(domain.id)}
                        >
                          {busy === "domain-check" ? t("domains.checking") : t("domains.checkDnsSsl")}
                        </button>
                      )}
                      <button
                        className={styles.linkBtn}
                        disabled={busy === "domain-delete"}
                        onClick={() => removeDomainById(domain.id, domain.hostname)}
                      >
                        {t("common.disconnect")}
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
            {t("github.intro")}
          </p>

          <div className={styles.domainForm}>
            {process.env.NEXT_PUBLIC_GITHUB_APP_SLUG ? (
              <a
                className={btnPrimary}
                href={`https://github.com/apps/${process.env.NEXT_PUBLIC_GITHUB_APP_SLUG}/installations/new?state=${encodeURIComponent(`${workspaceId}:${websiteId}`)}`}
              >
                {t("github.install")}
              </a>
            ) : (
              <span className={styles.dim}>{t("github.configureSlug")}</span>
            )}
            <input
              className={inputClass}
              placeholder={t("github.installationPlaceholder")}
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
              {busy === "github-repos" ? t("github.loading") : t("github.viewRepos")}
            </button>
          </div>

          {githubRepos.length > 0 && (
            <div className={styles.domainForm}>
              <select
                className={selectClass}
                value={githubRepoId}
                onChange={(e) => setGithubRepoId(e.target.value)}
                aria-label={t("github.repoAria")}
              >
                {githubRepos.map((repo) => (
                  <option key={repo.id} value={repo.id}>
                    {repo.fullName}{repo.private ? ` · ${t("github.private")}` : ""}
                  </option>
                ))}
              </select>
              <select
                className={selectClass}
                value={githubServiceId}
                onChange={(e) => setGithubServiceId(e.target.value)}
                aria-label={t("github.serviceAria")}
              >
                <option value="">{t("domains.staticDefault")}</option>
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
                {busy === "github-connect" ? t("github.connecting") : t("github.connectRepo")}
              </button>
            </div>
          )}

          {githubConnections.length === 0 ? (
            <p className={styles.empty}>{t("github.empty")}</p>
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
                      <span className={`${styles.badge} ${styles.domainOk}`}>{t("github.connected")}</span>
                      <span className={styles.dim}>
                        {t("github.branch", { branch: connection.defaultBranch })} · {targetServices ? targetServices.name : t("common.staticSite")}
                      </span>
                    </div>
                    <div className={styles.domainActions}>
                      <button
                        className={styles.linkBtn}
                        disabled={busy === "github-disconnect"}
                        onClick={() => disconnectGitHubRepo(connection.id, connection.repositoryFullName)}
                      >
                        {t("common.disconnect")}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* ── Monetization ── */}
        <section className={`${styles.panel} ${styles.span2}`} aria-label={t("money.aria")}>
          <h2 className={styles.panelTitle}>{t("money.title")}</h2>
          <div className={styles.twoCols}>
            {subscriptionCard(
              t("money.hosting"),
              hostingSub,
              plansByKind("HOSTING"),
              hostingPlanId,
              setHostingPlanId,
              "HOSTING"
            )}
            {subscriptionCard(
              t("money.tier"),
              tierSub,
              plansByKind("MAINTENANCE"),
              tierPlanId,
              setTierPlanId,
              "MAINTENANCE",
              allowance && allowance.hasMembership ? (
                <p className={styles.allowanceLine}>
                  {allowance.quotaIncluded === null
                    ? t("money.unlimitedChanges")
                    : `${t("money.usage", { used: allowance.usedThisPeriod, quota: allowance.quotaIncluded })}${allowance.remaining !== null ? t("money.remainingSuffix", { remaining: allowance.remaining }) : ""}`}
                </p>
              ) : undefined
            )}
          </div>
        </section>

        {/* ── One-time charges ── */}
        <section className={styles.panel} aria-label={t("charge.aria")}>
          <h2 className={styles.panelTitle}>{t("charge.title")}</h2>
          <div className={styles.stack}>
            <input className={inputClass} placeholder={t("charge.titlePlaceholder")} value={chargeTitle} onChange={(e) => setChargeTitle(e.target.value)} />
            <input className={inputClass} placeholder="1500.00" inputMode="decimal" value={chargePrice} onChange={(e) => setChargePrice(e.target.value)} />
            <button className={btnPrimary} disabled={busy === "create-charge"} onClick={() => createOneTimeCharge()}>
              {copiedKey?.startsWith("charge-") ? t("charge.created") : busy === "create-charge" ? t("charge.creating") : t("charge.create")}
            </button>
          </div>
          {charges.length > 0 && (
            <ul className={styles.miniList}>
              {charges.map((c) => (
                <li key={c.id} className={styles.chargeRow}>
                  <span>{c.title}</span>
                  <span className={`${styles.badge} ${styles[`chg-${c.status.toLowerCase()}`]}`}>
                    {t(CHARGE_STATUS_KEY[c.status])}
                  </span>
                  <span className={`${styles.mono} ${styles.right}`}>
                    {moneyFromDecimal(c.amountDecimal, c.currency)}
                  </span>
                  {c.status === "PENDING" && (
                    <button className={styles.linkBtn} disabled={busy === `cancel-charge-${c.id}`} onClick={() => cancelChargeById(c.id)}>
                      {t("charge.cancel")}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ── Maintenance ── */}
        <section className={`${styles.panel} ${styles.span2}`} aria-label={t("maint.title")}>
          <h2 className={styles.panelTitle}>{t("maint.title")}</h2>
          {requests.length === 0 ? (
            <p className={styles.empty}>{t("maint.empty")}</p>
          ) : (
            <ul className={styles.reqList}>
              {requests.map((r) => (
                <li key={r.id} className={styles.reqItem}>
                  <div className={styles.reqHead}>
                    <strong>{r.title}</strong>
                    <span className={styles.badge}>{t(REQ_STATUS_KEY[r.status])}</span>
                  </div>
                  <p className={styles.reqDesc}>{r.description}</p>
                  {r.priceCents !== null && (
                    <p className={`${styles.mono} ${styles.dim}`}>{money(r.priceCents, r.currency ?? "USD")}</p>
                  )}
                  <div className={styles.reqActions}>
                    {r.status === "OPEN" && (
                      <>
                        <button className={btnGhost} disabled={busy === `req-${r.id}`} onClick={() => requestAction("quote", r.id)}>{t("maint.quote")}</button>
                        <button className={btnPrimary} disabled={busy === `req-${r.id}`} onClick={() => requestAction("start", r.id)}>{t("maint.start")}</button>
                      </>
                    )}
        {r.status === "PAID" && (
          <button className={btnPrimary} disabled={busy === `req-${r.id}`} onClick={() => requestAction("start", r.id)}>{t("maint.start")}</button>
        )}
        {r.status === "IN_PROGRESS" && (
          <button className={btnPrimary} disabled={busy === `req-${r.id}`} onClick={() => requestAction("complete", r.id)}>{t("maint.complete")}</button>
        )}
        {r.status === "PENDING_PAYMENT" && (
          <button className={btnPrimary} disabled={busy === `req-${r.id}`} onClick={() => requestAction("mark-paid", r.id)}>{t("maint.markPaid")}</button>
        )}
                    {r.status === "COMPLETED" && (
                      <button className={btnGhost} disabled={busy === `req-${r.id}`} onClick={() => requestAction("approve", r.id)}>{t("maint.approveByClient")}</button>
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
