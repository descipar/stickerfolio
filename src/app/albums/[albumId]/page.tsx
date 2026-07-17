import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getActiveCollector } from "@/lib/active-collector";
import { getAlbum } from "@/lib/db";
import { AlbumTracker } from "@/components/album-tracker";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ albumId: string }> }): Promise<Metadata> {
  const collector = await getActiveCollector();
  const album = collector ? getAlbum(collector.id, Number((await params).albumId)) : null;
  return { title: album?.name ?? "Album" };
}

export default async function AlbumPage({ params }: { params: Promise<{ albumId: string }> }) {
  const collector = await getActiveCollector();
  const album = collector ? getAlbum(collector.id, Number((await params).albumId)) : null;
  if (!album) notFound();
  return <AlbumTracker initialAlbum={album} />;
}
