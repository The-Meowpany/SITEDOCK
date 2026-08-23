import styles from "./ui.module.css";

/** Field + input/select wrappers to keep forms consistent across the console. */
export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className={styles.field}>
      <span className={styles.fieldLabel}>{label}</span>
      {children}
    </label>
  );
}

export const inputClass = styles.input;
export const selectClass = styles.select;
export const btnPrimary = styles.btnPrimary;
export const btnGhost = styles.btnGhost;
export const btnDanger = styles.btnDanger;
export const formRow = styles.formRow;
