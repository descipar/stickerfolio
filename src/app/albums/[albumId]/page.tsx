import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getAlbum } from "@/lib/db";
import { AlbumTracker } from "@/components/album-tracker";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ albumId: string }> }): Promise<Metadata> {
  const album = getAlbum(Number((await params).albumId));
  return { title: album?.name ?? "Album" };
}

export default async function AlbumPage({ params }: { params: Promise<{ albumId: string }> }) {
  const album = getAlbum(Number((await params).albumId));
  if (!album) notFound();
  return <AlbumTracker initialAlbum={album} />;
}
