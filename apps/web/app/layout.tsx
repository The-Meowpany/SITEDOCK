import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SiteDock — Client portal",
  description: "Check the status of your site, your subscription and your requests.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
