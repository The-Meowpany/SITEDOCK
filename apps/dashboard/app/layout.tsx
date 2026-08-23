import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SiteDock — Consola del developer",
  description: "Tu cartera de sitios como un negocio recurrente: MRR, suscripciones y clientes.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
