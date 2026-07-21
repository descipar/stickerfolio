// Pure, framework-free helpers for the trade partner overview UI. Keeping these
// side-effect free lets them be unit tested in the Node test project without a
// DOM harness, and keeps the client component focused on rendering.

export interface MatchCounts {
  kind: "one-way" | "two-way";
  offeredCount: number;
  wantedCount: number;
}

/**
 * Human-readable summary used as the accessible label for a partner's
 * expand/collapse control. "offered" stickers are what the current collector
 * could receive; "wanted" stickers are what they could give away.
 */
export function describeMatch(match: MatchCounts): string {
  const kind = match.kind === "two-way" ? "Two-way match" : "One-way match";
  return `${kind}: ${match.offeredCount} to receive, ${match.wantedCount} to give`;
}

/** Renders the "1–20 of 45" style range shown above the partner list. */
export function formatRange(offset: number, shown: number, total: number): string {
  if (total <= 0 || shown <= 0) return "0 of 0";
  const start = offset + 1;
  const end = offset + shown;
  return `${start}–${end} of ${total}`;
}

export interface TradeFilterValues {
  direction: string;
  section: string;
  sort: string;
}

/**
 * Builds a deterministic query string for the trades page. Defaults
 * (all/compatibility/page 1) are omitted so shared links stay clean and match
 * the server component's default parsing.
 */
export function buildTradeQuery(filters: TradeFilterValues, page: number): string {
  const params = new URLSearchParams();
  if (filters.direction && filters.direction !== "all") params.set("direction", filters.direction);
  if (filters.section) params.set("section", filters.section);
  if (filters.sort && filters.sort !== "compatibility") params.set("sort", filters.sort);
  if (page > 1) params.set("page", String(page));
  return params.toString();
}

/** Total number of pages for a result set, never below 1. */
export function pageCount(total: number, pageSize: number): number {
  if (pageSize <= 0) return 1;
  return Math.max(1, Math.ceil(total / pageSize));
}
