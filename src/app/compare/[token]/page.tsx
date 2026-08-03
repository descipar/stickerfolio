import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { AppNavigation, DirectComparisonJoin } from "@/components";
import { resolveIdentity } from "@/modules/identity";
import {
  DirectComparisonError,
  getOwnComparisonSetup,
  isComparisonToken,
} from "@/modules/trading";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Direct comparison · Stickerfolio",
  description: "Privately compare two compatible Stickerfolio collections.",
  robots: { index: false, follow: false, nocache: true },
};

export default async function ComparisonLinkPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const requestHeaders = await headers();
  const identity = await resolveIdentity(requestHeaders);
  if (!identity) redirect("/login");
  if (identity.mustChangePassword) redirect("/password/change");
  if (!identity.collector) redirect(identity.role === "admin" ? "/admin/users" : "/");
  if (!identity.collector.onboardingCompleted) redirect("/onboarding");

  const { token } = await params;
  if (!isComparisonToken(token)) notFound();
  let setup;
  try {
    setup = await getOwnComparisonSetup(requestHeaders, { token });
  } catch (error) {
    if (error instanceof DirectComparisonError) notFound();
    throw error;
  }

  return (
    <main className="page-shell">
      <header className="app-header">
        <Link className="brand-link" href="/albums"><span aria-hidden="true">S</span><strong>Stickerfolio</strong></Link>
        <AppNavigation isAdmin={identity.role === "admin"} displayName={identity.collector.displayName} />
      </header>
      <Link className="back-link" href="/albums">← All albums</Link>
      <section className="overview-intro comparison-intro">
        <p className="eyebrow">Private invitation</p>
        <h1 className="overview-title">Compare your albums</h1>
        <p className="overview-subtitle">
          Choose your compatible album to calculate the current exchange opportunities.
        </p>
      </section>
      <DirectComparisonJoin initialCredential={{ token }} initialSetup={setup} />
    </main>
  );
}
