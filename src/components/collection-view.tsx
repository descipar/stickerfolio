"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";

import { CollectionSharing } from "./collection-sharing";
import { CollectionComparison } from "./collection-comparison";

type Filter = "all" | "missing" | "owned" | "duplicates";

interface Sticker {
  id: string;
  code: string;
  label: string;
  sectionId: string;
  sectionCode: string;
  sectionName: string;
  sortOrder: number;
  quantity: number;
}

interface CollectionSummary {
  id: string;
  albumTitle: string;
  revisionNumber: number;
}

interface SectionProgress {
  id: string;
  code: string;
  name: string;
  owned: number;
  total: number;
}

const filters: Array<{ value: Filter; label: string }> = [
  { value: "all", label: "All" },
  { value: "missing", label: "Missing" },
  { value: "owned", label: "Owned" },
  { value: "duplicates", label: "Duplicates" },
];

export function CollectionView({ collectionId }: { collectionId: string }) {
  const [stickers, setStickers] = useState<Sticker[] | null>(null);
  const [collection, setCollection] = useState<CollectionSummary | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedSection, setSelectedSection] = useState("all");
  const [error, setError] = useState("");
  const [savedSticker, setSavedSticker] = useState<string | null>(null);
  const [pending, setPending] = useState<Set<string>>(new Set());

  useEffect(() => {
    void Promise.all([
      fetch(`/api/collections/${collectionId}/stickers`, { cache: "no-store" }),
      fetch("/api/collections", { cache: "no-store" }),
    ]).then(async ([stickersResponse, collectionsResponse]) => {
      if (!stickersResponse.ok) {
        setError(stickersResponse.status === 404 ? "Album not found." : "Stickers could not be loaded.");
        return;
      }
      const stickerData = await stickersResponse.json() as { stickers: Sticker[] };
      setStickers(stickerData.stickers);
      if (collectionsResponse.ok) {
        const overview = await collectionsResponse.json() as { collections: CollectionSummary[] };
        setCollection(overview.collections.find((item) => item.id === collectionId) ?? null);
      }
    });
  }, [collectionId]);

  const progress = useMemo(() => {
    const all = stickers ?? [];
    const sectionMap = new Map<string, SectionProgress>();
    for (const sticker of all) {
      const section = sectionMap.get(sticker.sectionId) ?? {
        id: sticker.sectionId,
        code: sticker.sectionCode,
        name: sticker.sectionName,
        owned: 0,
        total: 0,
      };
      section.total += 1;
      if (sticker.quantity > 0) section.owned += 1;
      sectionMap.set(sticker.sectionId, section);
    }
    const owned = all.filter((sticker) => sticker.quantity > 0).length;
    return {
      owned,
      missing: all.length - owned,
      duplicates: all.reduce((sum, sticker) => sum + Math.max(0, sticker.quantity - 1), 0),
      total: all.length,
      sections: [...sectionMap.values()],
    };
  }, [stickers]);

  const visible = useMemo(() => {
    if (!stickers) return [];
    const term = search.trim().toLocaleLowerCase();
    return stickers.filter((sticker) => {
      const matchesSection = selectedSection === "all" || sticker.sectionId === selectedSection;
      const matchesSearch = !term
        || `${sticker.code} ${sticker.label} ${sticker.sectionCode} ${sticker.sectionName}`.toLocaleLowerCase().includes(term);
      const matchesFilter = filter === "all"
        || (filter === "missing" && sticker.quantity === 0)
        || (filter === "owned" && sticker.quantity > 0)
        || (filter === "duplicates" && sticker.quantity > 1);
      return matchesSection && matchesSearch && matchesFilter;
    });
  }, [filter, search, selectedSection, stickers]);

  async function updateQuantity(sticker: Sticker, requested: number) {
    const quantity = Math.max(0, Math.min(99, Math.round(requested)));
    if (pending.has(sticker.id) || quantity === sticker.quantity) return;
    const previous = sticker.quantity;
    setError("");
    setSavedSticker(null);
    setPending((current) => new Set(current).add(sticker.id));
    setStickers((current) => current?.map((item) => item.id === sticker.id ? { ...item, quantity } : item) ?? null);
    const response = await fetch(`/api/collections/${collectionId}/holdings/${sticker.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quantity }),
    });
    if (!response.ok) {
      setStickers((current) => current?.map((item) => item.id === sticker.id ? { ...item, quantity: previous } : item) ?? null);
      setError(`Could not save ${sticker.code}. Try again.`);
    } else {
      setSavedSticker(sticker.id);
      window.setTimeout(() => setSavedSticker((current) => current === sticker.id ? null : current), 1200);
    }
    setPending((current) => {
      const next = new Set(current);
      next.delete(sticker.id);
      return next;
    });
  }

  if (!stickers && !error) return <p className="state-message" role="status">Loading stickers…</p>;
  if (!stickers) return <p className="state-message error" role="alert">{error}</p>;

  const percent = progress.total ? Math.round(progress.owned / progress.total * 100) : 0;
  const activeSection = progress.sections.find((section) => section.id === selectedSection);
  const listTitle = activeSection ? activeSection.name : "All stickers";

  return (
    <div className="collection-view">
      <section className="collection-hero" aria-labelledby="collection-title">
        <div className="collection-hero-copy">
          <p className="eyebrow">Your collection</p>
          <h1 id="collection-title">{collection?.albumTitle ?? "Sticker album"}</h1>
          <p>{progress.total} stickers · {progress.sections.length} teams and sections</p>
        </div>
        <div
          className="progress-ring"
          style={{ "--progress": `${percent * 3.6}deg` } as CSSProperties}
          aria-label={`${percent}% complete`}
        >
          <span><strong>{percent}%</strong><small>complete</small></span>
        </div>
      </section>

      <section className="collection-stat-grid" aria-label="Album progress">
        <article><span>Missing</span><strong>{progress.missing}</strong></article>
        <article><span>Owned</span><strong>{progress.owned}</strong></article>
        <article><span>Duplicates</span><strong>{progress.duplicates}</strong></article>
      </section>

      <section className="collection-export" aria-label="Export lists as CSV">
        <a className="primary-button inline-action" href={`/albums/${collectionId}/trades`}>
          Find trade partners
        </a>
        <a className="secondary-button" href={`/api/collections/${collectionId}/export?type=missing`} download>
          Export missing list (CSV)
        </a>
        <a className="secondary-button" href={`/api/collections/${collectionId}/export?type=duplicates`} download>
          Export duplicates list (CSV)
        </a>
      </section>

      <CollectionComparison collectionId={collectionId} />

      <CollectionSharing collectionId={collectionId} />

      <section className="collection-controls" aria-label="Find and filter stickers">
        <label className="search-field collection-search">
          <span aria-hidden="true">⌕</span>
          <span className="visually-hidden">Search stickers</span>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search code, sticker, or team"
          />
        </label>

        <div className="filter-tabs" role="group" aria-label="Filter sticker status">
          {filters.map(({ value, label }) => (
            <button
              key={value}
              className={filter === value ? "active" : ""}
              type="button"
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="section-strip" role="group" aria-label="Choose a team or section">
          <button
            className={selectedSection === "all" ? "active" : ""}
            type="button"
            aria-pressed={selectedSection === "all"}
            onClick={() => setSelectedSection("all")}
          >
            <strong>All</strong><small>{progress.owned}/{progress.total}</small>
          </button>
          {progress.sections.map((section) => (
            <button
              key={section.id}
              className={selectedSection === section.id ? "active" : ""}
              type="button"
              aria-pressed={selectedSection === section.id}
              title={section.name}
              onClick={() => setSelectedSection(section.id)}
            >
              <strong>{section.code}</strong><small>{section.owned}/{section.total}</small>
            </button>
          ))}
        </div>
      </section>

      {error ? <p className="state-message error" role="alert">{error}</p> : null}

      <section className="sticker-results" aria-labelledby="sticker-results-title">
        <div className="results-heading">
          <div><p className="eyebrow">{activeSection?.code ?? "Album"}</p><h2 id="sticker-results-title">{listTitle}</h2></div>
          <span aria-live="polite">{visible.length} results</span>
        </div>

        {visible.length === 0 ? (
          <div className="card empty-state"><h3>No matching stickers</h3><p className="muted">Change the team, search, or status filter.</p></div>
        ) : (
          <ol className="sticker-list">
            {visible.map((sticker) => {
              const isPending = pending.has(sticker.id);
              const status = sticker.quantity === 0 ? "missing" : sticker.quantity > 1 ? "duplicate" : "owned";
              const statusText = status === "missing"
                ? "Missing"
                : status === "duplicate"
                  ? `${sticker.quantity - 1} ${sticker.quantity === 2 ? "duplicate" : "duplicates"}`
                  : "Owned";
              return (
                <li className={`sticker-row sticker-${status}`} key={sticker.id}>
                  <span className="sticker-state-mark" aria-hidden="true">{sticker.quantity > 0 ? "✓" : ""}</span>
                  <div className="sticker-copy">
                    <strong>{sticker.code}</strong>
                    <span>{sticker.sectionName}</span>
                    <small>{savedSticker === sticker.id ? "Saved" : statusText}</small>
                  </div>
                  <div className="quantity-control" aria-label={`Quantity for ${sticker.code}`}>
                    <button type="button" disabled={isPending || sticker.quantity === 0} aria-label={`Decrease ${sticker.code}`} onClick={() => void updateQuantity(sticker, sticker.quantity - 1)}>−</button>
                    <input
                      key={`${sticker.id}-${sticker.quantity}`}
                      aria-label={`Quantity for ${sticker.code}`}
                      type="number"
                      inputMode="numeric"
                      min="0"
                      max="99"
                      defaultValue={sticker.quantity}
                      disabled={isPending}
                      onBlur={(event) => {
                        const quantity = Number(event.target.value);
                        if (Number.isInteger(quantity) && quantity >= 0 && quantity <= 99) {
                          void updateQuantity(sticker, quantity);
                        } else {
                          event.target.value = String(sticker.quantity);
                          setError("Enter a quantity from 0 through 99.");
                        }
                      }}
                      onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
                    />
                    <button type="button" disabled={isPending || sticker.quantity === 99} aria-label={`Increase ${sticker.code}`} onClick={() => void updateQuantity(sticker, sticker.quantity + 1)}>+</button>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </div>
  );
}
