import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { OnboardingFlow } from "@/components/onboarding-flow";
import { resolveIdentity } from "@/modules/identity";

export default async function OnboardingPage() {
  const identity = await resolveIdentity(await headers());
  if (!identity) redirect("/login");
  if (identity.mustChangePassword) redirect("/password/change");
  // An administrator without a collector profile is never forced into collector
  // onboarding; send them to the areas they actually manage.
  if (!identity.collector) redirect(identity.role === "admin" ? "/admin/albums" : "/albums");
  // Onboarding is a one-time step; a collector who already completed it is sent
  // to their albums rather than shown the flow again.
  if (identity.collector.onboardingCompleted) redirect("/albums");

  return (
    <main className="page-shell">
      <header className="app-header">
        <div><p className="eyebrow">Stickerfolio</p><h1 className="page-title">Welcome</h1></div>
      </header>
      <OnboardingFlow initialDisplayName={identity.collector.displayName} />
    </main>
  );
}
