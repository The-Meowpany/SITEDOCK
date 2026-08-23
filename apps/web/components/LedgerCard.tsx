import styles from "./LedgerCard.module.css";

export function LedgerCard({ children }: { children: React.ReactNode }) {
  return <div className={styles.card}>{children}</div>;
}

export function LedgerSection({ eyebrow, children }: { eyebrow?: string; children: React.ReactNode }) {
  return (
    <div className={styles.section}>
      {eyebrow && <p className={styles.eyebrow}>{eyebrow}</p>}
      {children}
    </div>
  );
}

export function Perforation() {
  return <div className={styles.perforation} aria-hidden="true" />;
}
