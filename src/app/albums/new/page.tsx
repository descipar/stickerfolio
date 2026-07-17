import type { Metadata } from "next";
import { NewAlbumForm } from "@/components/new-album-form";

export const metadata: Metadata = { title: "Album importieren" };

export default function NewAlbumPage() {
  return <NewAlbumForm />;
}
