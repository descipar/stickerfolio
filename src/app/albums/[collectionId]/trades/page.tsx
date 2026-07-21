import { headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { AppNavigation } from "@/components/app-navigation";
import { TradeMatches } from "@/components/trade-matches";
import { buildTradeQuery } from "@/components/trade-summary";
import { resolveIdentity } from "@/modules/identity";
import {
  getOwnTradeMatches,
  TradingError,
  type TradeDirection,
  type TradeMatchResult,
  type TradeSort,
} from "@/modules/trading";

const PAGE_SIZE = 20;
const DIRECTIONS = ["all", "one-way", "two-way"] as const;
const SORTS = ["compatibility", "offered", "wanted", "name"] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function pick<T extends string>(value: string | undefined, allowed: readonly T[], fallback: T): T {
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

// Server component: mirrors the album pages by resolving the authenticated,
// onboarded collector and calling the trading use case directly. The data is
// strictly read: this page issues no mutations and cannot change holdings.
export default async function TradeMatchesPage({
  params,
  searchParams,
}: {
  params: Promise<{ collectionId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const requestHeaders = await headers();
  const identity = await resolveIdentity(requestHeaders);
  if (!identity) redirect("/login");
  if (identity.mustChangePassword) redirect("/password/change");
  if (!identity.collector) redirect(identity.role === "admin" ? "/admin/users" : "/");
  if (!identity.collector.onboardingCompleted) redirect("/onboarding");

  const { collectionId } = await params;
  const query = await searchParams;
  const direction = pick<TradeDirection>(first(query.direction), DIRECTIONS, "all");
  const sort = pick<TradeSort>(first(query.sort), SORTS, "compatibility");
  const sectionValue = first(query.section) ?? "";
  const section = UUID.test(sectionValue) ? sectionValue : "";
  const parsedPage = Number.parseInt(first(query.page) ?? "1", 10);
  const page = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1;

  let result: TradeMatchResult;
  try {
    result = await getOwnTradeMatches(requestHeaders, collectionId, {
      direction,
      ...(section ? { sectionId: section } : {}),
      sort,
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    });
  } catch (error) {
    if (error instanceof TradingError && error.status === 404) notFound();
    throw error;
  }

  // Clamp out-of-range pagination: a stale or crafted ?page beyond the last
  // valid page would otherwise show an empty list next to "Page N of M".
  // Once the real total is known, redirect to the canonical last valid page.
  const totalPages = Math.max(1, Math.ceil(result.total / PAGE_SIZE));
  if (result.total > 0 && page > totalPages) {
    const canonical = buildTradeQuery({ direction, section, sort }, totalPages);
    redirect(canonical ? `/albums/${collectionId}/trades?${canonical}` : `/albums/${collectionId}/trades`);
  }

  return (
    <main className="page-shell wide-shell">
      <header className="app-header">
        <Link className="brand-link" href="/albums"><span aria-hidden="true">S</span><strong>Stickerfolio</strong></Link>
        <AppNavigation isAdmin={identity.role === "admin"} displayName={identity.collector.displayName} />
      </header>
      <Link className="back-link" href={`/albums/${collectionId}`}>← Back to album</Link>
      <TradeMatches result={result} filters={{ direction, section, sort }} page={page} pageSize={PAGE_SIZE} />
    </main>
  );
}
