import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";

import {
  credentials,
  expectNoHorizontalOverflow,
  readSeededState,
  storageStatePaths,
} from "./fixtures";

/**
 * Direct collection comparison by QR link or manual code (issue #95), verified
 * at the iPhone 13 viewport. The collector creates a grant on their album page;
 * the seeded partner joins it from a separate signed-in browser context.
 */
test.use({ storageState: storageStatePaths.collector });

interface CreatedGrant {
  grant: { id: string };
  code: string;
  url: string;
}

async function createGrant(page: Page): Promise<CreatedGrant> {
  const { collectionId } = readSeededState();
  await page.goto(`/albums/${collectionId}`);
  await expect(page.getByRole("heading", { name: "Direct comparison" })).toBeVisible();

  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/collections/${collectionId}/comparison-grants`) &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Create comparison code" }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(201);
  const created = (await response.json()) as CreatedGrant;

  await expect(page.getByAltText(/QR code that opens this direct Stickerfolio comparison/)).toBeVisible();
  await expect(page.getByText(created.code, { exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  return created;
}

async function partnerContext(browser: Browser, baseURL: string | undefined): Promise<BrowserContext> {
  // browser.newContext() would otherwise inherit the file-level collector
  // session; use the partner session prepared once in global setup so the suite
  // stays within the per-process sign-in rate limit.
  return browser.newContext({
    baseURL,
    storageState: storageStatePaths.partner,
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  });
}

async function expectComparisonResult(page: Page): Promise<void> {
  await expect(
    page.getByRole("heading", { name: `You and ${credentials.collector.displayName}` }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: new RegExp(`${credentials.collector.displayName} can offer you`) }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: new RegExp(`You can offer ${credentials.collector.displayName}`) }),
  ).toBeVisible();
  await expect(page.getByText(credentials.collector.email)).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
}

test.describe("direct collection comparison", () => {
  test("partner compares by manual code and by QR link", async ({ page, browser, baseURL }) => {
    const created = await createGrant(page);
    const partner = await partnerContext(browser, baseURL);
    try {
      const partnerPage = await partner.newPage();

      await partnerPage.goto("/compare");
      await partnerPage.getByRole("textbox", { name: "Comparison code" }).fill(created.code.toLowerCase());
      await partnerPage.getByRole("button", { name: "Continue" }).click();
      await expect(partnerPage.getByRole("heading", { name: "Choose your album" })).toBeVisible();
      await expectNoHorizontalOverflow(partnerPage);
      await partnerPage.getByRole("button", { name: "Compare now" }).click();
      await expectComparisonResult(partnerPage);

      await partnerPage.goto(new URL(created.url).pathname);
      await expect(partnerPage.getByRole("heading", { name: "Compare your albums" })).toBeVisible();
      await partnerPage.getByRole("button", { name: "Compare now" }).click();
      await expectComparisonResult(partnerPage);
    } finally {
      await partner.close();
    }
  });

  test("a revoked code no longer opens the comparison", async ({ page, browser, baseURL }) => {
    const created = await createGrant(page);

    const row = page.locator(".share-row").filter({ has: page.locator(".status-badge.active") }).first();
    await row.getByRole("button", { name: "Revoke" }).click();
    await expect(page.getByText("Comparison code revoked.")).toBeVisible();

    const partner = await partnerContext(browser, baseURL);
    try {
      const partnerPage = await partner.newPage();
      await partnerPage.goto("/compare");
      await partnerPage.getByRole("textbox", { name: "Comparison code" }).fill(created.code);
      await partnerPage.getByRole("button", { name: "Continue" }).click();
      await expect(partnerPage.getByText(/^Comparison unavailable\./)).toBeVisible();

      const linkResponse = await partnerPage.goto(new URL(created.url).pathname);
      expect(linkResponse?.status()).toBe(404);
    } finally {
      await partner.close();
    }
  });
});
