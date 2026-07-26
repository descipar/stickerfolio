import fs from "node:fs";

import { request, type APIRequestContext } from "@playwright/test";

import { authDir, credentials, stateFile, storageStatePaths } from "./fixtures";

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3500";

async function waitForReady(context: APIRequestContext): Promise<void> {
  const deadline = Date.now() + 60_000;
  let lastError = "not ready";
  while (Date.now() < deadline) {
    try {
      const response = await context.get("/api/health/ready");
      if (response.ok()) return;
      lastError = `status ${response.status()}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`Application did not become ready at ${baseURL}: ${lastError}`);
}

async function signIn(email: string, password: string, storagePath: string): Promise<APIRequestContext> {
  const context = await request.newContext({ baseURL });
  const response = await context.post("/api/auth/sign-in/email", { data: { email, password } });
  if (!response.ok()) {
    throw new Error(`Sign-in failed for ${email}: ${response.status()} ${await response.text()}`);
  }
  await context.storageState({ path: storagePath });
  return context;
}

/**
 * Prepares authenticated storage states and discovers the collector's seeded
 * collection id. Authenticating the collector and newcomer here (rather than
 * through the UI in every spec) keeps the suite well under the application's
 * per-process sign-in rate limit and makes the album/onboarding journeys
 * deterministic.
 */
export default async function globalSetup(): Promise<void> {
  fs.mkdirSync(authDir, { recursive: true });

  const probe = await request.newContext({ baseURL });
  await waitForReady(probe);
  await probe.dispose();

  const collectorContext = await signIn(
    credentials.collector.email,
    credentials.collector.password,
    storageStatePaths.collector,
  );
  const overviewResponse = await collectorContext.get("/api/collections");
  if (!overviewResponse.ok()) {
    throw new Error(`Could not load collections for the collector: ${overviewResponse.status()}`);
  }
  const overview = (await overviewResponse.json()) as {
    collections: Array<{ id: string; albumTitle: string }>;
  };
  const collection =
    overview.collections.find((item) => item.albumTitle.includes("World Cup")) ??
    overview.collections[0];
  if (!collection) {
    throw new Error("The collector has no seeded collection; run `pnpm seed:e2e` first.");
  }
  fs.writeFileSync(stateFile, JSON.stringify({ collectionId: collection.id }));
  await collectorContext.dispose();

  const newcomerContext = await signIn(
    credentials.newcomer.email,
    credentials.newcomer.password,
    storageStatePaths.newcomer,
  );
  await newcomerContext.dispose();
}
