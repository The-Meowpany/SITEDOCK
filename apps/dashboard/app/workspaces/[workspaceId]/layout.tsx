"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./layout.module.css";
import { AppHeader } from "@/components/AppHeader";

const NAV = [
  { href: "", label: "Resumen" },
  { href: "/sitios", label: "Sitios" },
  { href: "/planes", label: "Planes y tiers" },
  { href: "/settings", label: "Settings" },
];

/**
 * Console shell: sidebar navigation + session header. Every console page of a
 * workspace renders inside this layout. The workspace id is derived from the
 * pathname so the nav stays link-driven.
 */
export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles.shell}>
      <AppHeader subtitle="Consola del developer" />
      <Nav />
      <main className={styles.main}>{children}</main>
    </div>
  );
}

function Nav() {
  const pathname = usePathname() ?? "";
  const wsId = pathname.split("/")[2] ?? "";
  const base = `/workspaces/${wsId}`;

  return (
    <nav className={styles.nav} aria-label="Secciones de la consola">
      {NAV.map((item) => {
        const href = `${base}${item.href}`;
        const active = item.href === "" ? pathname === base : pathname.startsWith(href);
        return (
          <Link key={item.href} href={href} className={`${styles.navItem} ${active ? styles.active : ""}`}>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
