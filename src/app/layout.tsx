import type { Metadata, Viewport } from "next";
import Link from "next/link";
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

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const collectorName = process.env.COLLECTOR_NAME?.trim() || "Sarah";
  return (
    <html lang="de">
      <body>
        <header className="site-header">
          <Link href="/" className="brand" aria-label="Stickerfolio Startseite">
            <span className="brand-mark">S</span>
            <span>Stickerfolio</span>
          </Link>
          <span className="collector-pill">{collectorName}</span>
        </header>
        <main className="page-shell">{children}</main>
      </body>
    </html>
  );
}
