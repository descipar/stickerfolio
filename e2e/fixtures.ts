import fs from "node:fs";
import path from "node:path";

import { expect, type Page } from "@playwright/test";

/**
 * Credentials and shared expectations for the mobile acceptance suite. The
 * credentials must match the accounts created by `scripts/seed-e2e.ts`.
 */
export const credentials = {
  collector: {
    email: "collector@e2e.test",
    password: "e2e-collector-pass",
    displayName: "E2E Collector",
  },
  partner: {
    displayName: "E2E Partner",
  },
  newcomer: {
    email: "onboarding@e2e.test",
    password: "e2e-onboarding-pass",
    displayName: "E2E Newcomer",
  },
  firstAdmin: {
    email: "firstadmin@e2e.test",
    password: "e2e-admin-temp",
    displayName: "E2E First Admin",
  },
} as const;

export const albumTitle = "Panini FIFA World Cup 2026";

const authDir = path.join(process.cwd(), "e2e", ".auth");

export const storageStatePaths = {
  collector: path.join(authDir, "collector.json"),
  newcomer: path.join(authDir, "newcomer.json"),
};

export const stateFile = path.join(authDir, "state.json");
export { authDir };

export interface SeededState {
  collectionId: string;
}

export function readSeededState(): SeededState {
  return JSON.parse(fs.readFileSync(stateFile, "utf8")) as SeededState;
}

/**
 * Asserts the current document does not scroll horizontally at the mobile
 * viewport width. This is the concrete "no horizontal overflow" acceptance
 * check from issue #44.
 */
export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const metrics = await page.evaluate(() => {
    const element = document.scrollingElement ?? document.documentElement;
    return {
      scrollWidth: element.scrollWidth,
      innerWidth: window.innerWidth,
    };
  });
  expect(
    metrics.scrollWidth,
    `expected no horizontal overflow but scrollWidth ${metrics.scrollWidth} exceeds viewport ${metrics.innerWidth}`,
  ).toBeLessThanOrEqual(metrics.innerWidth + 1);
}
