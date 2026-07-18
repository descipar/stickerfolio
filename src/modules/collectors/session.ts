import type { QueryExecutor } from "@/infrastructure/database";
import {
  requireCollector,
  type IdentityContext,
  type StickerfolioAuth,
} from "@/modules/identity";

export type CollectorContext = IdentityContext & {
  collector: NonNullable<IdentityContext["collector"]>;
};

export async function requireCollectorContext(
  headers: Headers,
  auth?: StickerfolioAuth,
  executor?: QueryExecutor,
): Promise<CollectorContext> {
  return requireCollector(headers, auth, executor);
}
