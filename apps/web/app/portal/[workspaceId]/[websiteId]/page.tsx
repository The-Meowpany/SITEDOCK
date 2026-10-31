"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import styles from "./page.module.css";
import { LedgerCard, LedgerSection, Perforation } from "@/components/LedgerCard";
import { StatusStamp } from "@/components/StatusStamp";
import { SubscriptionReceipt } from "@/components/SubscriptionReceipt";
import { MaintenancePanel } from "@/components/MaintenancePanel";
import { api, ApiError, type MaintenanceRequestSummary, type SubscriptionDetail, type WebsiteDetail } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import { siteHostname } from "@/lib/site-domain";

interface PortalData {
  website: WebsiteDetail;
  subscription: SubscriptionDetail | null;
  tier: { planName: string; remaining: number | null; quotaIncluded: number | null; status: string } | null;
  requests: MaintenanceRequestSummary[];
  charges: Array<{ id: string; title: string; status: "PENDING" | "PAID" | "CANCELED"; amountDecimal: string; currency: string; createdAt: string }>;
}

export default function PortalPage() {
  const params = useParams<{ workspaceId: string; websiteId: string }>();
  const router = useRouter();
  const { t } = useI18n();
  const tRef = useRef(t);
  tRef.current = t;
  const [data, setData] = useState<PortalData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [website, subscription, tierSub, requests, allowance, charges] = await Promise.all([
          api.getWebsite(params.workspaceId, params.websiteId),
          api.getSubscription(params.workspaceId, params.websiteId),
          api.getSubscription(params.workspaceId, params.websiteId, "MAINTENANCE"),
          api.listMaintenanceRequests(params.workspaceId, params.websiteId),
          api.getAllowance(params.workspaceId, params.websiteId).catch(() => null),
          api.listCharges(params.workspaceId, params.websiteId).catch(() => []),
        ]);
        if (cancelled) return;

        const tier =
          allowance && allowance.hasMembership && tierSub
            ? {
                planName: allowance.planName,
                remaining: allowance.remaining,
                quotaIncluded: allowance.quotaIncluded,
                status: tierSub.status,
              }
            : null;

        setData({ website, subscription, tier, requests, charges });
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) {
          router.replace("/login");
          return;
        }
        setError(tRef.current("portal.loadError"));
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [params.workspaceId, params.websiteId, router]);

  if (error) {
    return (
      <main className={styles.center}>
        <p className={styles.error}>{error}</p>
      </main>
    );
  }

  if (!data) {
    return (
      <main className={styles.center}>
        <p className={styles.loading}>{t("home.loading")}</p>
      </main>
    );
  }

  const { website, subscription, tier, requests, charges } = data;

  async function handleLogout() {
    await api.logout().catch(() => {});
    router.replace("/login");
  }

  return (
    <main className={styles.page}>
      <button className={styles.logout} onClick={handleLogout}>
        {t("portal.logout")}
      </button>
      <div className={styles.wrap}>
        <LedgerCard>
          <LedgerSection eyebrow={t("portal.serviceCard")}>
            <h1 className={styles.siteName}>{website.name}</h1>
            <p className={styles.subdomain}>{siteHostname(website.subdomain)}</p>
            <div className={styles.stampSlot}>
              <StatusStamp status={website.status} />
            </div>
          </LedgerSection>

          <Perforation />

          <LedgerSection eyebrow={t("portal.subscription")}>
            <SubscriptionReceipt subscription={subscription} />
            {tier && (
              <div className={styles.tierNote}>
                <strong>{tier.planName}</strong>
                {tier.quotaIncluded === null
                  ? t("portal.unlimitedChanges")
                  : t("portal.remaining", { remaining: tier.remaining ?? 0, quota: tier.quotaIncluded })}
              </div>
            )}
            {charges.length > 0 && (
              <ul className={styles.charges}>
                {charges.slice(0, 3).map((c) => (
                  <li key={c.id}>
                    <span>{c.title}</span>
                    <span className={`${styles.chargeStatus} ${c.status === "PAID" ? styles.paid : ""}`}>
                      {t(`charge.${c.status}`)} ·{" "}
                      {c.currency === "USD" ? "$" : ""}
                      {c.amountDecimal}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </LedgerSection>

          <Perforation />

          <LedgerSection eyebrow={t("portal.requests")}>
            <MaintenancePanel workspaceId={params.workspaceId} websiteId={params.websiteId} initialRequests={requests} />
          </LedgerSection>
        </LedgerCard>
      </div>
    </main>
  );
}
