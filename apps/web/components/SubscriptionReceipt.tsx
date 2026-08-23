import styles from "./SubscriptionReceipt.module.css";
import type { SubscriptionDetail } from "@/lib/api-client";

const STATUS_LABEL: Record<SubscriptionDetail["status"], string> = {
  INCOMPLETE: "Incompleta",
  TRIALING: "Período de prueba",
  ACTIVE: "Activa",
  PAST_DUE: "Pago pendiente",
  PAUSED: "Pausada",
  GRACE_PERIOD: "Período de gracia",
  SUSPENDED: "Suspendida",
  CANCELED: "Cancelada",
  EXPIRED: "Vencida",
};

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric" });
}

export function SubscriptionReceipt({ subscription }: { subscription: SubscriptionDetail | null }) {
  if (!subscription) {
    return <p className={styles.empty}>Todavía no hay una suscripción activa para este sitio.</p>;
  }

  const intervalLabel = subscription.billingInterval === "MONTHLY" ? "mes" : "año";

  return (
    <dl className={styles.receipt}>
      <div className={styles.line}>
        <dt>Plan</dt>
        <dd className={styles.amount}>
          {subscription.currency} {subscription.priceDecimal} <span className={styles.perInterval}>/ {intervalLabel}</span>
        </dd>
      </div>
      <div className={styles.line}>
        <dt>Estado</dt>
        <dd>{STATUS_LABEL[subscription.status]}</dd>
      </div>
      <div className={styles.line}>
        <dt>Próxima renovación</dt>
        <dd className={styles.mono}>{formatDate(subscription.nextBillingDate)}</dd>
      </div>
      {subscription.gracePeriodEndsAt && (
        <div className={styles.line}>
          <dt>Fin del período de gracia</dt>
          <dd className={styles.mono}>{formatDate(subscription.gracePeriodEndsAt)}</dd>
        </div>
      )}
    </dl>
  );
}
