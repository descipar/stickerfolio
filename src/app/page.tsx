import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { resolveIdentity } from "@/modules/identity";

export default async function HomePage() {
  const identity = await resolveIdentity(await headers());
  if (!identity) redirect("/login");
  if (identity.mustChangePassword) redirect("/password/change");
  redirect(identity.role === "admin" && !identity.collector ? "/admin/users" : "/albums");
}
