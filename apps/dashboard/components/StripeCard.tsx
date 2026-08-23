"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api } from "@/lib/api-client";
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
 * Tarjeta de conexión con Stripe Connect (Fase 16): CTA de onboarding cuando
 * no hay cuenta, estado live/pending/restricted cuando existe. Solo visible
 * cuando el entorno tiene Stripe activo (la API responde 501 → se oculta).
 */
export function StripeCard() {
  const params = useParams<{ workspaceId: string }>();
  const workspaceId = params.workspaceId;

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
        else setHidden(true); // sin Stripe configurado, la tarjeta no aporta
      });
  }, [workspaceId]);

  useEffect(() => {
    load();
  }, [load]);

  async function connect() {
    setBusy(true);
    setError(null);
    try {
      // Onboarding hosted de Stripe: redirige fuera y vuelve al returnUrl.
      window.location.href = (await api.connectMerchant(workspaceId)).url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos iniciar la conexión.");
      setBusy(false);
    }
  }

  if (hidden || status === null) return null;

  if (status.status === "ACTIVE") {
    return (
      <section className={`${styles.card} ${styles.active}`} aria-label="Stripe conectado">
        <span className={styles.dot} aria-hidden />
        <div>
          <strong>Stripe conectado</strong>
          <p className={styles.dim}>Cobros y transferencias habilitados para este workspace.</p>
        </div>
        <a className={styles.link} href="https://dashboard.stripe.com" target="_blank" rel="noreferrer">
          Abrir Stripe
        </a>
      </section>
    );
  }

  return (
    <section className={styles.card} aria-label="Conectar Stripe">
      <div>
        <strong>
          {status.status === "PENDING_ONBOARDING"
            ? "Onboarding de Stripe pendiente"
            : status.status === "RESTRICTED"
              ? `Cuenta restringida${status.disabledReason ? ` — ${status.disabledReason}` : ""}`
              : "Aceptá pagos reales"}
        </strong>
        <p className={styles.dim}>
          Conectá tu cuenta de Stripe para cobrar las suscripciones y los proyectos con dinero real.
          SiteDock nunca retiene tus fondos.
        </p>
      </div>
      <button className={btnPrimary} disabled={busy} onClick={connect}>
        {busy ? "Redirigiendo…" : status.status === "PENDING_ONBOARDING" ? "Continuar onboarding" : "Conectar con Stripe"}
      </button>
      {error && <p className={styles.error}>{error}</p>}
    </section>
  );
}
