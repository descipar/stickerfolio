import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { resolveIdentity } from "@/modules/identity";

export default async function HomePage() {
  const identity = await resolveIdentity(await headers());
  if (!identity) redirect("/login");
  if (identity.mustChangePassword) redirect("/password/change");
  // A collector who has not completed onboarding is always routed to it, so a
  // later sign-in or a direct visit can never bypass onboarding server-side.
  if (identity.collector && !identity.collector.onboardingCompleted) redirect("/onboarding");
  redirect(identity.role === "admin" && !identity.collector ? "/admin/users" : "/albums");
}
