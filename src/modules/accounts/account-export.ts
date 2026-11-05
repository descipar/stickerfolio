import type { Pool, PoolClient } from "pg";

import { getPool, query, withTransaction } from "@/infrastructure/database";
import { writeAuditEvent } from "@/infrastructure/observability";
import { exportCollectionsForCollector } from "@/modules/collections";
import { exportCollectorProfile } from "@/modules/collectors";
import { exportAccountRecord } from "@/modules/identity";
import { exportTradingDataForCollector } from "@/modules/trading";
import { AuthenticationError, type Principal, requirePrincipal } from "@/shared/principal";

export const accountExportFormat = "stickerfolio-account-export";
export const accountExportVersion = 3;

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
      shareLinks: Array<{
        id: string;
        scope: "missing" | "duplicates" | "both";
        expiresAt: string | null;
        revokedAt: string | null;
        createdAt: string;
        updatedAt: string;
      }>;
      comparisonGrants: Array<{
        id: string;
        expiresAt: string;
        revokedAt: string | null;
        createdAt: string;
        updatedAt: string;
      }>;
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

/**
 * Composes the export from each module's own contribution (#125). A new
 * module that stores per-collector data adds its contribution here; the
 * data-ownership test keeps it from reading another module's tables instead.
 */
async function loadAccountDataExport(
  client: PoolClient,
  userId: string,
  exportedAt: Date,
): Promise<AccountDataExport> {
  const account = await exportAccountRecord(userId, client);
  if (!account) throw new AuthenticationError("Authentication required.");
  const base: AccountDataExport = {
    format: accountExportFormat,
    version: accountExportVersion,
    exportedAt: exportedAt.toISOString(),
    account,
    collector: null,
  };

  const profile = await exportCollectorProfile(userId, client);
  if (!profile) return base;
  const collections = await exportCollectionsForCollector(profile.id, client);
  const trading = await exportTradingDataForCollector(profile.id, client);

  base.collector = {
    ...profile,
    tradingPreferences: trading.preferences,
    collections: collections.map((collection) => ({
      id: collection.id,
      status: collection.status,
      createdAt: collection.createdAt,
      updatedAt: collection.updatedAt,
      album: collection.album,
      revision: collection.revision,
      shareLinks: collection.shareLinks,
      comparisonGrants: trading.comparisonGrants
        .filter((grant) => grant.collectionId === collection.id)
        .map((grant) => ({
          id: grant.id,
          expiresAt: grant.expiresAt,
          revokedAt: grant.revokedAt,
          createdAt: grant.createdAt,
          updatedAt: grant.updatedAt,
        })),
      holdings: collection.holdings,
    })),
  };
  return base;
}

export async function exportOwnAccountData(
  principal: Principal | null,
  pool: Pool = getPool(),
  exportedAt = new Date(),
): Promise<AccountDataExport> {
  const identity = requirePrincipal(principal);
  const data = await withTransaction(async (client) => {
    await query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY", [], client);
    return loadAccountDataExport(client, identity.userId, exportedAt);
  }, pool);
  writeAuditEvent(
    "account.exported",
    { type: "user", userId: identity.userId },
    { type: "user", id: identity.userId },
  );
  return data;
}

export function accountExportFileName(exportedAt: Date): string {
  return `stickerfolio-account-export-${exportedAt.toISOString().slice(0, 10)}.json`;
}
