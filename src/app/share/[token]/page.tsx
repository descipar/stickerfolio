import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { loadSharedCollection } from "@/modules/collections";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Shared sticker list · Stickerfolio",
  description: "A private, read-only Stickerfolio list.",
  robots: { index: false, follow: false, nocache: true },
};

const scopeLabels = {
  missing: "Missing stickers",
  duplicates: "Duplicates",
  both: "Missing stickers and duplicates",
} as const;

export default async function SharedCollectionPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const collection = await loadSharedCollection(token);
  if (!collection) notFound();

  return (
    <main className="page-shell shared-page">
      <header className="shared-header">
        <span className="brand-link"><span aria-hidden="true">S</span><strong>Stickerfolio</strong></span>
        <span className="status-badge">Read-only</span>
      </header>

      <section className="shared-hero">
        <p className="eyebrow">Shared sticker list</p>
        <h1>{collection.albumTitle}</h1>
        <p>
          Revision {collection.revisionNumber} · {scopeLabels[collection.scope]}
          {collection.expiresAt
            ? ` · expires ${new Date(collection.expiresAt).toLocaleDateString()}`
            : ""}
        </p>
      </section>

      <section className="collection-stat-grid" aria-label="Shared list totals">
        {collection.scope !== "duplicates" ? (
          <article><span>Missing</span><strong>{collection.missingCount}</strong></article>
        ) : null}
        {collection.scope !== "missing" ? (
          <article><span>Duplicate stickers</span><strong>{collection.duplicateCount}</strong></article>
        ) : null}
      </section>

      {collection.sections.length === 0 ? (
        <section className="card empty-state">
          <h2>Nothing to show</h2>
          <p className="muted">The selected list is currently empty.</p>
        </section>
      ) : (
        <div className="shared-sections">
          {collection.sections.map((section) => (
            <section className="card shared-section" key={`${section.code}-${section.name}`}>
              <header>
                <div><p className="eyebrow">{section.code}</p><h2>{section.name}</h2></div>
                <span className="count-badge">{section.stickers.length}</span>
              </header>
              <ul className="shared-sticker-list">
                {section.stickers.map((sticker) => (
                  <li key={`${sticker.kind}-${sticker.code}`}>
                    <span>
                      <strong>{sticker.code}</strong>
                      <small>{sticker.label}</small>
                    </span>
                    <span className={`status-badge ${sticker.kind}`}>
                      {sticker.kind === "missing"
                        ? "Missing"
                        : `${sticker.spareCount} spare${sticker.spareCount === 1 ? "" : "s"}`}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      <footer className="shared-footer">
        This live list can change when its owner updates the collection. It does not reserve or transfer stickers.
      </footer>
    </main>
  );
}
