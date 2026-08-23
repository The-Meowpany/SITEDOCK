"use client";

import { useState } from "react";
import styles from "./MaintenancePanel.module.css";
import { api, type MaintenanceRequestSummary, type TierCoverage } from "@/lib/api-client";

const STATUS_LABEL: Record<MaintenanceRequestSummary["status"], string> = {
  OPEN: "Recibido",
  IN_PROGRESS: "En progreso",
  WAITING_CLIENT: "Esperando tu respuesta",
  PENDING_PAYMENT: "Pendiente de pago",
  PAID: "Pagado",
  COMPLETED: "Completado — a revisar",
  APPROVED: "Aprobado",
  CANCELED: "Cancelado",
};

function coverageNote(tier: TierCoverage): string {
  if (!tier.hasMembership) return "Enviado. Tu desarrollador te va a cotizar este cambio.";
  if (tier.covered) {
    const left =
      tier.remaining === null || tier.remaining === undefined
        ? "cambios ilimitados"
        : tier.remaining === 1
          ? "te queda 1 este período"
          : `quedan ${tier.remaining} este período`;
    return `Cubierto por tu plan ${tier.planName} (${left}).`;
  }
  return "Enviado. Ya usaste las incluidas en tu plan, así que tu desarrollador te va a enviar una cotización.";
}

export function MaintenancePanel({
  workspaceId,
  websiteId,
  initialRequests,
}: {
  workspaceId: string;
  websiteId: string;
  initialRequests: MaintenanceRequestSummary[];
}) {
  const [requests, setRequests] = useState(initialRequests);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [coverage, setCoverage] = useState<TierCoverage | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !description.trim()) return;

    setSubmitting(true);
    setError(null);
    setCoverage(null);
    try {
      const result = await api.createMaintenanceRequest(workspaceId, websiteId, title.trim(), description.trim());
      const updated = await api.listMaintenanceRequests(workspaceId, websiteId);
      setRequests(updated);
      setTitle("");
      setDescription("");
      setCoverage(result.tier);
    } catch {
      setError("No pudimos enviar tu solicitud. Probá de nuevo en un momento.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      {requests.length === 0 ? (
        <p className={styles.empty}>Todavía no pediste ningún cambio.</p>
      ) : (
        <ul className={styles.list}>
          {requests.map((r) => (
            <li key={r.id} className={styles.item}>
              <div className={styles.itemHeader}>
                <span className={styles.itemTitle}>{r.title}</span>
                <span className={`${styles.badge} ${styles[`status_${r.status}`]}`}>{STATUS_LABEL[r.status]}</span>
              </div>
              <p className={styles.itemDescription}>{r.description}</p>
              {r.priceCents !== null && (
                <p className={styles.itemPrice}>
                  {r.currency} {(r.priceCents / 100).toFixed(2)}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      <form className={styles.form} onSubmit={handleSubmit}>
        <p className={styles.formLabel}>Pedir un cambio</p>
        <input
          className={styles.input}
          placeholder="Ej: Cambiar el horario de atención"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={120}
          required
        />
        <textarea
          className={styles.textarea}
          placeholder="Contanos qué necesitás cambiar en tu sitio."
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          required
        />
        {coverage && (
          <p className={styles.coverageNote} role="status">
            {coverageNote(coverage)}
          </p>
        )}
        {error && <p className={styles.error}>{error}</p>}
        <button className={styles.submit} type="submit" disabled={submitting}>
          {submitting ? "Enviando…" : "Enviar solicitud"}
        </button>
      </form>
    </div>
  );
}
