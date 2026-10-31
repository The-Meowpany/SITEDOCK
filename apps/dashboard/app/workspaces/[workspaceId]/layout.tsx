"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./layout.module.css";
import { AppHeader } from "@/components/AppHeader";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n";

const NAV: Array<{ href: string; labelKey: MessageKey }> = [
  { href: "", labelKey: "nav.overview" },
  { href: "/sitios", labelKey: "nav.sites" },
  { href: "/planes", labelKey: "nav.plans" },
  { href: "/equipo", labelKey: "nav.team" },
  { href: "/settings", labelKey: "nav.settings" },
];

/**
 * Console shell: sidebar navigation + session header. Every console page of a
 * workspace renders inside this layout. The workspace id is derived from the
 * pathname so the nav stays link-driven.
 */
export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  return (
    <div className={styles.shell}>
      <AppHeader subtitle={t("header.subtitle.developer")} />
      <Nav />
      <main className={styles.main}>{children}</main>
    </div>
  );
}

function Nav() {
  const { t } = useI18n();
  const pathname = usePathname() ?? "";
  const wsId = pathname.split("/")[2] ?? "";
  const base = `/workspaces/${wsId}`;

  return (
    <nav className={styles.nav} aria-label={t("nav.label")}>
      {NAV.map((item) => {
        const href = `${base}${item.href}`;
        const active = item.href === "" ? pathname === base : pathname.startsWith(href);
        return (
          <Link key={item.href} href={href} className={`${styles.navItem} ${active ? styles.active : ""}`}>
            {t(item.labelKey)}
          </Link>
        );
      })}
    </nav>
  );
}
