import type { MessageKey } from "./i18n/messages";

/** "2026-08" → "Aug 26" (localized month abbreviation, always rendered in UTC so it never shifts a month). */
export function shortMonth(monthKey: string, locale = "en"): string {
  const [year = "", month = ""] = monthKey.split("-");
  const idx = Number(month) - 1;
  if (!Number.isInteger(idx) || idx < 0 || idx > 11) return `${month} ${year.slice(2)}`;
  const name = new Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" }).format(
    new Date(Date.UTC(2000, idx, 1))
  );
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

const STATUS_KEYS: Record<string, MessageKey> = {
  DRAFT: "status.DRAFT",
  PREVIEW: "status.PREVIEW",
  PENDING_APPROVAL: "status.PENDING_APPROVAL",
  APPROVED: "status.APPROVED",
  LIVE: "status.LIVE",
  PAST_DUE: "status.PAST_DUE",
  GRACE_PERIOD: "status.GRACE_PERIOD",
  SUSPENDED: "status.SUSPENDED",
  ARCHIVED: "status.ARCHIVED",
};

/** Message key for a website status, or null for a status the console does not know (rendered raw). */
export function statusKey(status: string): MessageKey | null {
  return STATUS_KEYS[status] ?? null;
}

export function moneyFromDecimal(decimal: string, currency = "USD"): string {
  const symbol = currency === "USD" ? "$" : `${currency} `;
  return `${symbol}${decimal}`;
}
