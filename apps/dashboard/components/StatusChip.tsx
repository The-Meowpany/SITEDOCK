import { statusLabel } from "@/lib/format";
import styles from "./StatusChip.module.css";

const TONE_CLASS: Record<string, string> = {
  LIVE: "live",
  PAST_DUE: "past_due",
  GRACE_PERIOD: "grace_period",
  SUSPENDED: "suspended",
};

/** Compact status indicator shared by tables across the console. */
export function StatusChip({ status }: { status: string }) {
  const tone = TONE_CLASS[status] ?? status.toLowerCase();
  return (
    <span className={`${styles.chip} ${styles[tone] ?? ""}`}>
      <span className={styles.dot} aria-hidden />
      {statusLabel(status)}
    </span>
  );
}

/** Numbered checklist shown when the workspace is brand new (empty state). */
export function OnboardingChecklist() {
  return (
    <ol className={styles.onboarding}>
      <li>Creá un proyecto y un sitio desde la API (POST /websites)</li>
      <li>Subí el ZIP de tu sitio y obtené la vista previa</li>
      <li>Creá tu plan mensual (ej. Profesional US$29)</li>
      <li>Generá el checkout y enviáselo a tu cliente</li>
      <li>Cuando pague, el sitio pasa a LIVE y el MRR aparece acá</li>
    </ol>
  );
}
