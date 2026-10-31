"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { api } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import { btnPrimary } from "./ui";
import styles from "./StripeCard.module.css";

type MerchantStatus =
  | { status: "NOT_CONNECTED" }
  | {
      status: "PENDING_ONBOARDING" | "ACTIVE" | "RESTRICTED" | "DISCONNECTED";
      chargesEnabled: boolean;
      payoutsEnabled: boolean;
      disabledReason: string | null;
      onboardedAt: string | null;
    };

/**
 * Stripe Connect connection card (Phase 16): onboarding CTA when
 * there is no account, live/pending/restricted status when there is one. Only visible
 * when the environment has Stripe enabled (the API answers 501 → it is hidden).
 */
export function StripeCard() {
  const params = useParams<{ workspaceId: string }>();
  const workspaceId = params.workspaceId;
  const { t } = useI18n();
  const tRef = useRef(t);
  tRef.current = t;

  const [status, setStatus] = useState<MerchantStatus | null>(null);
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .getMerchantStatus(workspaceId)
      .then(setStatus)
      .catch((err) => {
        if (err instanceof Error && /STRIPE_NOT_CONFIGURED|501/i.test(err.message)) setHidden(true);
        else setHidden(true); // without Stripe configured the card adds nothing
      });
  }, [workspaceId]);

  useEffect(() => {
    load();
  }, [load]);

  async function connect() {
    setBusy(true);
    setError(null);
    try {
      // Stripe-hosted onboarding: redirects away and comes back to returnUrl.
      window.location.href = (await api.connectMerchant(workspaceId)).url;
    } catch (err) {
      setError(err instanceof Error ? err.message : tRef.current("stripe.connectError"));
      setBusy(false);
    }
  }

  if (hidden || status === null) return null;

  if (status.status === "ACTIVE") {
    return (
      <section className={`${styles.card} ${styles.active}`} aria-label={t("stripe.connected")}>
        <span className={styles.dot} aria-hidden />
        <div>
          <strong>{t("stripe.connected")}</strong>
          <p className={styles.dim}>{t("stripe.connectedHint")}</p>
        </div>
        <a className={styles.link} href="https://dashboard.stripe.com" target="_blank" rel="noreferrer">
          {t("stripe.open")}
        </a>
      </section>
    );
  }

  return (
    <section className={styles.card} aria-label={t("stripe.aria.connect")}>
      <div>
        <strong>
          {status.status === "PENDING_ONBOARDING"
            ? t("stripe.pending")
            : status.status === "RESTRICTED"
              ? `${t("stripe.restricted")}${status.disabledReason ? ` — ${status.disabledReason}` : ""}`
              : t("stripe.accept")}
        </strong>
        <p className={styles.dim}>
          {t("stripe.hint")}
        </p>
      </div>
      <button className={btnPrimary} disabled={busy} onClick={connect}>
        {busy ? t("stripe.redirecting") : status.status === "PENDING_ONBOARDING" ? t("stripe.continue") : t("stripe.connect")}
      </button>
      {error && <p className={styles.error}>{error}</p>}
    </section>
  );
}
