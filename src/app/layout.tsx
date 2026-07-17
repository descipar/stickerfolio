import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { getActiveCollector } from "@/lib/active-collector";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Stickerfolio", template: "%s · Stickerfolio" },
  description: "Mobile Stickeralbum-Verwaltung",
  applicationName: "Stickerfolio",
  appleWebApp: { capable: true, title: "Stickerfolio", statusBarStyle: "default" },
  icons: { icon: "/icon.svg", apple: "/icon.svg" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f6f7fb",
  colorScheme: "light",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const collector = await getActiveCollector();
  return (
    <html lang="de">
      <body>
        <header className="site-header">
          <Link href="/" className="brand" aria-label="Stickerfolio Startseite">
            <span className="brand-mark">S</span>
            <span>Stickerfolio</span>
          </Link>
          <Link href="/collectors" className="collector-pill">{collector?.name ?? "Sammler anlegen"}</Link>
        </header>
        <main className="page-shell">{children}</main>
      </body>
    </html>
  );
}
