"use client";

import styles from "./StatusStamp.module.css";
import type { WebsiteDetail } from "@/lib/api-client";

const STAMP_COPY: Record<WebsiteDetail["status"], { label: string; note: string; tone: "live" | "warn" | "danger" | "neutral" }> = {
  LIVE: { label: "En línea", note: "Tu sitio está funcionando con normalidad.", tone: "live" },
  PAST_DUE: { label: "Pago pendiente", note: "Tu último pago no pudo procesarse. Revisá tu método de pago.", tone: "warn" },
  GRACE_PERIOD: { label: "Período de gracia", note: "Actualizá tu pago pronto para evitar la suspensión del sitio.", tone: "warn" },
  SUSPENDED: { label: "Suspendido", note: "Tu sitio está fuera de línea por falta de pago.", tone: "danger" },
  DRAFT: { label: "En preparación", note: "Tu desarrollador todavía está armando el sitio.", tone: "neutral" },
  PREVIEW: { label: "Vista previa", note: "Hay una versión lista para que la revises.", tone: "neutral" },
  PENDING_APPROVAL: { label: "Esperando tu aprobación", note: "Revisá la vista previa y aprobá los cambios.", tone: "neutral" },
  APPROVED: { label: "Aprobado", note: "Listo para publicarse.", tone: "neutral" },
  ARCHIVED: { label: "Archivado", note: "Este sitio ya no está activo.", tone: "neutral" },
  DELETED: { label: "Eliminado", note: "Este sitio fue eliminado.", tone: "neutral" },
};

export function StatusStamp({ status }: { status: WebsiteDetail["status"] }) {
  const copy = STAMP_COPY[status];
  const isLive = status === "LIVE";

  return (
    <div className={styles.row}>
      <div className={`${styles.stamp} ${styles[copy.tone]}`} role="status" aria-label={`Estado del sitio: ${copy.label}`}>
        {isLive && <span className={styles.pulse} aria-hidden="true" />}
        <span className={styles.stampLabel}>{copy.label}</span>
      </div>
      <p className={styles.note}>{copy.note}</p>
    </div>
  );
}
