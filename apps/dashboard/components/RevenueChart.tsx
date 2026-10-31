"use client";

import type { MoneyBreakdown } from "@/lib/api-client";
import { money, shortMonth } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import styles from "./RevenueChart.module.css";

interface RevenueChartProps {
  series: Array<{ month: string; entries: MoneyBreakdown[] }>;
}

/**
 * Six-month revenue as an inline SVG bar chart — no chart library, matching
 * this app's zero-UI-dependency convention. Multi-currency workspaces are
 * charted on their dominant currency; any other currencies are listed below.
 */
export function RevenueChart({ series }: RevenueChartProps) {
  const { t, locale } = useI18n();
  const totalsByCurrency = new Map<string, number>();
  for (const point of series) {
    for (const e of point.entries) {
      totalsByCurrency.set(e.currency, (totalsByCurrency.get(e.currency) ?? 0) + e.amountCents);
    }
  }

  const currencies = [...totalsByCurrency.entries()].sort((a, b) => b[1] - a[1]);
  const primary = currencies[0];
  const others = currencies.slice(1);

  if (!primary || totalsByCurrency.get(primary[0]) === 0) {
    return (
      <div className={styles.empty}>
        <p>{t("revenue.empty")}</p>
        <p className={styles.hint}>{t("revenue.emptyHint")}</p>
      </div>
    );
  }

  const points = series.map((point) => ({
    month: point.month,
    cents: point.entries.filter((e) => e.currency === primary![0]).reduce((acc, e) => acc + e.amountCents, 0),
  }));
  const max = Math.max(...points.map((p) => p.cents), 1);
  const width = 100 / points.length;
  const windowTotal = totalsByCurrency.get(primary[0]) ?? 0;

  return (
    <figure className={styles.figure}>
      <svg
        viewBox="0 0 100 46"
        preserveAspectRatio="none"
        role="img"
        aria-label={t("revenue.aria", { count: points.length, currency: primary[0] })}
      >
        {points.map((point, i) => {
          const h = point.cents === 0 ? 0.8 : Math.max((point.cents / max) * 42, 2);
          return (
            <rect
              key={point.month}
              x={i * width + width * 0.18}
              y={44 - h}
              width={width * 0.64}
              height={h}
              className={point.cents === 0 ? styles.barEmpty : styles.bar}
            >
              <title>{`${shortMonth(point.month, locale)}: ${money(point.cents, primary[0])}`}</title>
            </rect>
          );
        })}
      </svg>
      <figcaption className={styles.caption}>
        <span className={styles.months}>
          {points.map((point) => (
            <span key={point.month}>{shortMonth(point.month, locale)}</span>
          ))}
        </span>
        <span className={styles.total}>{t("revenue.total", { amount: money(windowTotal, primary[0]) })}</span>
        {others.length > 0 && (
          <span className={styles.hint}>
            {t("revenue.others", { currencies: others.map(([c]) => c).join(", ") })}
          </span>
        )}
      </figcaption>
    </figure>
  );
}
