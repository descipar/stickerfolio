import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AppNavigation, DirectComparisonJoin } from "@/components";
import { resolveIdentity } from "@/modules/identity";

export const metadata: Metadata = {
  title: "Direct comparison · Stickerfolio",
  description: "Privately compare two compatible Stickerfolio collections.",
  robots: { index: false, follow: false, nocache: true },
};

export default async function ComparePage() {
  const identity = await resolveIdentity(await headers());
  if (!identity) redirect("/login");
  if (identity.mustChangePassword) redirect("/password/change");
  if (!identity.collector) redirect(identity.role === "admin" ? "/admin/users" : "/");
  if (!identity.collector.onboardingCompleted) redirect("/onboarding");

  return (
    <main className="page-shell">
      <header className="app-header">
        <Link className="brand-link" href="/albums"><span aria-hidden="true">S</span><strong>Stickerfolio</strong></Link>
        <AppNavigation isAdmin={identity.role === "admin"} displayName={identity.collector.displayName} />
      </header>
      <Link className="back-link" href="/albums">← All albums</Link>
      <section className="overview-intro comparison-intro">
        <p className="eyebrow">Meet and compare</p>
        <h1 className="overview-title">Direct album comparison</h1>
        <p className="overview-subtitle">
          Compare only the useful duplicates and missing stickers without exposing either complete collection.
        </p>
      </section>
      <DirectComparisonJoin />
    </main>
  );
}
