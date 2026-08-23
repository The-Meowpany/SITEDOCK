import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SiteDock — Administración de plataforma",
  description: "Panel PLATFORM_ADMIN: tenants, usuarios, sitios, pagos y webhooks.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
