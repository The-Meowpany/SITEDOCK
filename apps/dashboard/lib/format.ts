const MONTHS_ES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** "2026-08" → "ago 26" */
export function shortMonth(monthKey: string): string {
  const [year, month] = monthKey.split("-");
  const idx = Number(month) - 1;
  const name = MONTHS_ES[idx] ?? month;
  return `${name} ${year.slice(2)}`;
}

export function money(cents: number, currency = "USD"): string {
  const symbol = currency === "USD" ? "$" : `${currency} `;
  return `${symbol}${(cents / 100).toFixed(2)}`;
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

const STATUS_LABELS_ES: Record<string, string> = {
  DRAFT: "Borrador",
  PREVIEW: "Vista previa",
  PENDING_APPROVAL: "Esperando aprobación",
  APPROVED: "Aprobado",
  LIVE: "En línea",
  PAST_DUE: "Pago vencido",
  GRACE_PERIOD: "Período de gracia",
  SUSPENDED: "Suspendido",
  ARCHIVED: "Archivado",
};

export function statusLabel(status: string): string {
  return STATUS_LABELS_ES[status] ?? status;
}

export function moneyFromDecimal(decimal: string, currency = "USD"): string {
  const symbol = currency === "USD" ? "$" : `${currency} `;
  return `${symbol}${decimal}`;
}
