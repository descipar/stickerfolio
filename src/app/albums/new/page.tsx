import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { NewAlbumForm } from "@/components/new-album-form";
import { getActiveCollector } from "@/lib/active-collector";

export const metadata: Metadata = { title: "Album importieren" };

export default async function NewAlbumPage() {
  if (!await getActiveCollector()) redirect("/collectors");
  return <NewAlbumForm />;
}
