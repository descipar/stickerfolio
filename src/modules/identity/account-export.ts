import type { Pool, PoolClient } from "pg";

import { getPool, query, withTransaction } from "@/infrastructure/database";

import { getAuth, type StickerfolioAuth } from "./auth";
import { AuthenticationError, requireIdentity } from "./session";

export const accountExportFormat = "stickerfolio-account-export";
export const accountExportVersion = 1;

interface ExportAccountRow {
  id: string;
  name: string;
  email: string;
  email_verified: boolean;
  image: string | null;
  role: "user" | "admin";
  status: "active" | "suspended";
  must_change_password: boolean;
  created_at: Date;
  updated_at: Date;
  collector_id: string | null;
  display_name: string | null;
  collector_created_at: Date | null;
  collector_updated_at: Date | null;
  onboarding_completed_at: Date | null;
  trading_visible: boolean | null;
  trading_updated_at: Date | null;
}

interface ExportHoldingRow {
  collection_id: string;
  collection_status: "active" | "archived";
  collection_created_at: Date;
  collection_updated_at: Date;
  album_id: string;
  album_slug: string;
  album_title: string;
  revision_id: string;
  revision_number: number;
  revision_label: string;
  revision_status: "draft" | "published" | "archived";
  sticker_id: string;
  stable_key: string;
  code: string;
  label: string;
  section_id: string;
  section_code: string;
  section_name: string;
  quantity: number;
  holding_updated_at: Date | null;
}

export interface AccountDataExport {
  format: typeof accountExportFormat;
  version: typeof accountExportVersion;
  exportedAt: string;
  account: {
    id: string;
    name: string;
    email: string;
    emailVerified: boolean;
    image: string | null;
    role: "user" | "admin";
    status: "active" | "suspended";
    passwordChangeRequired: boolean;
    createdAt: string;
    updatedAt: string;
  };
  collector: null | {
    id: string;
    displayName: string;
    createdAt: string;
    updatedAt: string;
    onboardingCompletedAt: string | null;
    tradingPreferences: {
      visible: boolean;
      updatedAt: string | null;
    };
    collections: Array<{
      id: string;
      status: "active" | "archived";
      createdAt: string;
      updatedAt: string;
      album: { id: string; slug: string; title: string };
      revision: {
        id: string;
        number: number;
        label: string;
        status: "draft" | "published" | "archived";
      };
      holdings: Array<{
        stickerId: string;
        stableKey: string;
        code: string;
        label: string;
        section: { id: string; code: string; name: string };
        quantity: number;
        updatedAt: string | null;
      }>;
    }>;
  };
}

async function loadAccountDataExport(
  client: PoolClient,
  userId: string,
  exportedAt: Date,
): Promise<AccountDataExport> {
  const accountResult = await query<ExportAccountRow>(
    `SELECT u.id, u.name, u.email, u."emailVerified" AS email_verified, u.image,
            u.role, u.status, u."mustChangePassword" AS must_change_password,
            u."createdAt" AS created_at, u."updatedAt" AS updated_at,
            cp.id AS collector_id, cp.display_name, cp.created_at AS collector_created_at,
            cp.updated_at AS collector_updated_at, cp.onboarding_completed_at,
            tp.visible AS trading_visible, tp.updated_at AS trading_updated_at
       FROM "user" u
       LEFT JOIN collector_profiles cp ON cp.user_id = u.id
       LEFT JOIN trading_preferences tp ON tp.collector_id = cp.id
      WHERE u.id = $1`,
    [userId],
    client,
  );
  const row = accountResult.rows[0];
  if (!row) throw new AuthenticationError("Authentication required.");

  const base: AccountDataExport = {
    format: accountExportFormat,
    version: accountExportVersion,
    exportedAt: exportedAt.toISOString(),
    account: {
      id: row.id,
      name: row.name,
      email: row.email,
      emailVerified: row.email_verified,
      image: row.image,
      role: row.role,
      status: row.status,
      passwordChangeRequired: row.must_change_password,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    },
    collector: null,
  };
  if (!row.collector_id) return base;

  const holdingsResult = await query<ExportHoldingRow>(
    `SELECT c.id AS collection_id, c.status AS collection_status,
            c.created_at AS collection_created_at, c.updated_at AS collection_updated_at,
            a.id AS album_id, a.slug AS album_slug, a.title AS album_title,
            r.id AS revision_id, r.revision_number, r.label AS revision_label,
            r.status AS revision_status, rs.sticker_id, st.stable_key, rs.code, rs.label,
            sec.id AS section_id, sec.code AS section_code, sec.name AS section_name,
            COALESCE(h.quantity, 0)::integer AS quantity,
            h.updated_at AS holding_updated_at
       FROM collections c
       JOIN albums a ON a.id = c.album_id
       JOIN album_revisions r ON r.id = c.revision_id
       JOIN album_revision_stickers rs ON rs.revision_id = c.revision_id
       JOIN stickers st ON st.id = rs.sticker_id
       JOIN album_sections sec ON sec.id = rs.section_id
       LEFT JOIN holdings h ON h.collection_id = c.id AND h.sticker_id = rs.sticker_id
      WHERE c.collector_id = $1
      ORDER BY c.created_at, c.id, sec.sort_order, rs.sort_order, rs.code`,
    [row.collector_id],
    client,
  );

  const collections = new Map<string, NonNullable<AccountDataExport["collector"]>["collections"][number]>();
  for (const holding of holdingsResult.rows) {
    let collection = collections.get(holding.collection_id);
    if (!collection) {
      collection = {
        id: holding.collection_id,
        status: holding.collection_status,
        createdAt: holding.collection_created_at.toISOString(),
        updatedAt: holding.collection_updated_at.toISOString(),
        album: {
          id: holding.album_id,
          slug: holding.album_slug,
          title: holding.album_title,
        },
        revision: {
          id: holding.revision_id,
          number: holding.revision_number,
          label: holding.revision_label,
          status: holding.revision_status,
        },
        holdings: [],
      };
      collections.set(holding.collection_id, collection);
    }
    collection.holdings.push({
      stickerId: holding.sticker_id,
      stableKey: holding.stable_key,
      code: holding.code,
      label: holding.label,
      section: {
        id: holding.section_id,
        code: holding.section_code,
        name: holding.section_name,
      },
      quantity: holding.quantity,
      updatedAt: holding.holding_updated_at?.toISOString() ?? null,
    });
  }

  base.collector = {
    id: row.collector_id,
    displayName: row.display_name!,
    createdAt: row.collector_created_at!.toISOString(),
    updatedAt: row.collector_updated_at!.toISOString(),
    onboardingCompletedAt: row.onboarding_completed_at?.toISOString() ?? null,
    tradingPreferences: {
      visible: row.trading_visible ?? false,
      updatedAt: row.trading_updated_at?.toISOString() ?? null,
    },
    collections: [...collections.values()],
  };
  return base;
}

export async function exportOwnAccountData(
  headers: Headers,
  auth: StickerfolioAuth = getAuth(),
  pool: Pool = getPool(),
  exportedAt = new Date(),
): Promise<AccountDataExport> {
  const identity = await requireIdentity(headers, auth, pool);
  return withTransaction(async (client) => {
    await query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY", [], client);
    return loadAccountDataExport(client, identity.userId, exportedAt);
  }, pool);
}

export function accountExportFileName(exportedAt: Date): string {
  return `stickerfolio-account-export-${exportedAt.toISOString().slice(0, 10)}.json`;
}
