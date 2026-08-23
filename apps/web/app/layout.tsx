import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SiteDock — Portal del cliente",
  description: "Revisá el estado de tu sitio, tu suscripción y tus solicitudes.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
