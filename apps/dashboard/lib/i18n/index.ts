"use client";

import { useCallback, useEffect, useState } from "react";
import { DEFAULT_LOCALE, SUPPORTED_LOCALES, catalogues } from "./messages";
import type { Locale, MessageKey } from "./messages";

const STORAGE_KEY = "sitedock.locale";

export type TranslateParams = Record<string, string | number>;

/** Fills `{placeholders}`; unknown placeholders are left visible so gaps are noticed, not hidden. */
export function translate(locale: Locale, key: MessageKey, params?: TranslateParams): string {
  const template = catalogues[locale][key] ?? catalogues[DEFAULT_LOCALE][key];
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match
  );
}

/** Maps "es-UY", "es_AR", "EN-us" ... to a supported locale, or null. */
export function matchLocale(candidate: string | null | undefined): Locale | null {
  if (!candidate) return null;
  const base = candidate.toLowerCase().split(/[-_]/)[0];
  return SUPPORTED_LOCALES.find((locale) => locale === base) ?? null;
}

/** Resolution order: explicit user choice, then NEXT_PUBLIC_DEFAULT_LOCALE, then the browser, then English. */
export function detectLocale(): Locale {
  try {
    const stored = matchLocale(window.localStorage.getItem(STORAGE_KEY));
    if (stored) return stored;
  } catch {
    // Storage can be unavailable (private mode, blocked cookies): fall through.
  }
  return (
    matchLocale(process.env.NEXT_PUBLIC_DEFAULT_LOCALE) ??
    matchLocale(typeof navigator === "undefined" ? null : navigator.language) ??
    DEFAULT_LOCALE
  );
}

/**
 * Translation hook. The first render always uses the default locale so server and client
 * markup match; the detected locale is applied right after hydration.
 */
export function useI18n() {
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);

  useEffect(() => {
    setLocaleState(detectLocale());
  }, []);

  // Keep <html lang> truthful for screen readers and browser translation.
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const t = useCallback(
    (key: MessageKey, params?: TranslateParams) => translate(locale, key, params),
    [locale]
  );

  const setLocale = useCallback((next: Locale) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Not persisted, still applied for this page view.
    }
    setLocaleState(next);
  }, []);

  /** Locale-aware date formatting. */
  const formatDate = useCallback(
    (value: string | Date) => new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(value)),
    [locale]
  );

  /** Locale-aware date/time formatting. */
  const formatDateTime = useCallback(
    (value: string | Date) =>
      new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)),
    [locale]
  );

  return { locale, setLocale, t, formatDate, formatDateTime };
}

export type { Locale, MessageKey } from "./messages";
export { SUPPORTED_LOCALES } from "./messages";
