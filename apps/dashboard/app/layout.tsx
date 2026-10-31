import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SiteDock — Developer console",
  description: "Your portfolio of sites as a recurring business: MRR, subscriptions and clients.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
