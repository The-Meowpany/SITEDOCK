import styles from "./MetricCard.module.css";

interface MetricCardProps {
  label: string;
  value: string;
  hint?: string;
  tone?: "neutral" | "good" | "warn" | "bad";
}

export function MetricCard({ label, value, hint, tone = "neutral" }: MetricCardProps) {
  return (
    <div className={`${styles.card} ${tone !== "neutral" ? styles[tone] : ""}`}>
      <p className={styles.label}>{label}</p>
      <p className={styles.value}>{value}</p>
      {hint && <p className={styles.hint}>{hint}</p>}
    </div>
  );
}
