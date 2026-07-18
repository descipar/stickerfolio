"use client";

import { useEffect, useMemo, useState } from "react";

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

export function CollectionView({ collectionId }: { collectionId: string }) {
  const [stickers, setStickers] = useState<Sticker[] | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [error, setError] = useState("");
  const [savedSticker, setSavedSticker] = useState<string | null>(null);
  const [pending, setPending] = useState<Set<string>>(new Set());

  useEffect(() => {
    void fetch(`/api/collections/${collectionId}/stickers`, { cache: "no-store" }).then(async (response) => {
      if (!response.ok) {
        setError(response.status === 404 ? "Album not found." : "Stickers could not be loaded.");
        return;
      }
      const data = await response.json() as { stickers: Sticker[] };
      setStickers(data.stickers);
    });
  }, [collectionId]);

  const visible = useMemo(() => {
    if (!stickers) return [];
    const term = search.trim().toLocaleLowerCase();
    return stickers.filter((sticker) => {
      const matchesSearch = !term || `${sticker.code} ${sticker.label}`.toLocaleLowerCase().includes(term);
      const matchesFilter = filter === "all"
        || (filter === "missing" && sticker.quantity === 0)
        || (filter === "owned" && sticker.quantity > 0)
        || (filter === "duplicates" && sticker.quantity > 1);
      return matchesSearch && matchesFilter;
    });
  }, [filter, search, stickers]);

  const progress = useMemo(() => {
    const all = stickers ?? [];
    const sectionMap = new Map<string, { id: string; name: string; owned: number; total: number }>();
    for (const sticker of all) {
      const section = sectionMap.get(sticker.sectionId) ?? {
        id: sticker.sectionId,
        name: sticker.sectionName,
        owned: 0,
        total: 0,
      };
      section.total += 1;
      if (sticker.quantity > 0) section.owned += 1;
      sectionMap.set(sticker.sectionId, section);
    }
    return {
      owned: all.filter((sticker) => sticker.quantity > 0).length,
      total: all.length,
      sections: [...sectionMap.values()],
    };
  }, [stickers]);

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
  return (
    <div className="content-stack">
      <section className="card progress-panel" aria-label="Album progress">
        <div className="progress-total">
          <strong>{percent}%</strong>
          <span>{progress.owned} of {progress.total} stickers</span>
        </div>
        <div className="progress-track"><span style={{ width: `${percent}%` }} /></div>
        <details>
          <summary>Progress by section</summary>
          <ul className="section-progress-list">
            {progress.sections.map((section) => (
              <li key={section.id}><span>{section.name}</span><strong>{section.owned}/{section.total}</strong></li>
            ))}
          </ul>
        </details>
      </section>

      <section className="sticky-tools" aria-label="Sticker search and filters">
        <label className="search-field">
          <span className="visually-hidden">Search stickers</span>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search code or name"
          />
        </label>
        <div className="filter-tabs" role="group" aria-label="Filter stickers">
          {(["all", "missing", "owned", "duplicates"] as Filter[]).map((value) => (
            <button
              key={value}
              className={filter === value ? "active" : ""}
              type="button"
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
            >
              {value === "all" ? "All" : value[0]!.toUpperCase() + value.slice(1)}
            </button>
          ))}
        </div>
      </section>

      {error ? <p className="state-message error" role="alert">{error}</p> : null}
      <p className="result-count" aria-live="polite">{visible.length} stickers</p>
      {visible.length === 0 ? (
        <div className="card empty-state"><h2>No matching stickers</h2><p className="muted">Change the search or filter.</p></div>
      ) : (
        <ol className="sticker-list">
          {visible.map((sticker) => {
            const isPending = pending.has(sticker.id);
            return (
              <li className="sticker-row" key={sticker.id}>
                <div className="sticker-copy">
                  <strong>{sticker.code}</strong>
                  <span>{sticker.label}</span>
                  <small>{sticker.sectionName}{savedSticker === sticker.id ? " · Saved" : ""}</small>
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
    </div>
  );
}
