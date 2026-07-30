import { expect, test } from "@playwright/test";

import {
  albumTitle,
  expectNoHorizontalOverflow,
  readSeededState,
  storageStatePaths,
} from "./fixtures";

test.use({ storageState: storageStatePaths.collector });

test.describe("album view", () => {
  test.beforeEach(async ({ page }) => {
    const { collectionId } = readSeededState();
    await page.goto(`/albums/${collectionId}`);
    await expect(page.getByRole("heading", { name: albumTitle })).toBeVisible();
  });

  test("renders the populated album without horizontal overflow", async ({ page }) => {
    await expect(page.getByRole("group", { name: "Filter sticker status" })).toBeVisible();
    // The sticker list has rendered its rows.
    expect(await page.locator("li.sticker-row").count()).toBeGreaterThan(0);
    await expectNoHorizontalOverflow(page);
  });

  test("searches by sticker code", async ({ page }) => {
    await page.getByPlaceholder("Search code, sticker, or team").fill("GER1");
    await expect(page.getByRole("button", { name: "Increase GER1", exact: true })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test("filters by missing, duplicates and owned status", async ({ page }) => {
    await page.getByRole("button", { name: "Missing", exact: true }).click();
    await expect(page.locator("li.sticker-row.sticker-owned")).toHaveCount(0);
    await expect(page.locator("li.sticker-row.sticker-duplicate")).toHaveCount(0);
    expect(await page.locator("li.sticker-row.sticker-missing").count()).toBeGreaterThan(0);

    await page.getByRole("button", { name: "Duplicates", exact: true }).click();
    await expect(page.locator("li.sticker-row.sticker-missing")).toHaveCount(0);
    await expect(page.locator("li.sticker-row.sticker-owned")).toHaveCount(0);
    expect(await page.locator("li.sticker-row.sticker-duplicate").count()).toBeGreaterThan(0);

    await page.getByRole("button", { name: "Owned", exact: true }).click();
    await expect(page.locator("li.sticker-row.sticker-missing")).toHaveCount(0);
    expect(await page.locator("li.sticker-row").count()).toBeGreaterThan(0);

    await expectNoHorizontalOverflow(page);
  });

  test("changes a quantity with the plus and minus controls", async ({ page }) => {
    await page.getByPlaceholder("Search code, sticker, or team").fill("GER1");
    const quantity = page.getByRole("spinbutton", { name: "Quantity for GER1", exact: true });
    const before = Number(await quantity.inputValue());

    await page.getByRole("button", { name: "Increase GER1", exact: true }).click();
    await expect(page.getByRole("spinbutton", { name: "Quantity for GER1", exact: true })).toHaveValue(
      String(before + 1),
    );

    await page.getByRole("button", { name: "Decrease GER1", exact: true }).click();
    await expect(page.getByRole("spinbutton", { name: "Quantity for GER1", exact: true })).toHaveValue(
      String(before),
    );
  });

  test("shows the empty state when nothing matches the search", async ({ page }) => {
    await page.getByPlaceholder("Search code, sticker, or team").fill("zzz-no-such-sticker");
    await expect(page.getByRole("heading", { name: "No matching stickers" })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test("filters are operable with the keyboard, without hover", async ({ page }) => {
    const missing = page.getByRole("button", { name: "Missing", exact: true });
    await missing.focus();
    await page.keyboard.press("Enter");
    await expect(missing).toHaveAttribute("aria-pressed", "true");
  });

  test("creates, opens, and revokes a read-only share link", async ({ page, browser }) => {
    await expect(page.getByRole("heading", { name: "Share your lists" })).toBeVisible();
    await page.getByRole("button", { name: "Create share link" }).click();
    const link = page.getByRole("textbox", { name: "New share link" });
    await expect(link).toBeVisible();
    const url = await link.inputValue();
    expect(url).toMatch(/\/share\/[A-Za-z0-9_-]{43}$/);

    const publicContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
    });
    const publicPage = await publicContext.newPage();
    const response = await publicPage.goto(url);
    expect(response?.status()).toBe(200);
    expect(response?.headers()["cache-control"]).toContain("no-store");
    expect(response?.headers()["referrer-policy"]).toBe("no-referrer");
    await expect(publicPage.getByRole("heading", { name: albumTitle })).toBeVisible();
    await expect(publicPage.getByText("Read-only", { exact: true })).toBeVisible();
    await expect(publicPage.getByText("Missing", { exact: true }).first()).toBeVisible();
    await expectNoHorizontalOverflow(publicPage);

    await page.getByRole("button", { name: "Revoke", exact: true }).first().click();
    await expect(page.getByText("Share link revoked.")).toBeVisible();
    const revoked = await publicPage.goto(url);
    expect(revoked?.status()).toBe(404);
    await publicContext.close();
  });
});

test.describe("album view error state", () => {
  test("shows an error when the album cannot be loaded", async ({ page }) => {
    await page.goto("/albums/00000000-0000-0000-0000-000000000000");
    await expect(page.getByRole("alert")).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
});

test.describe("album view loading state", () => {
  test("shows a loading status while stickers are being fetched", async ({ page }) => {
    const { collectionId } = readSeededState();
    let releaseRequest: (() => void) | undefined;
    const requestReleased = new Promise<void>((resolve) => {
      releaseRequest = resolve;
    });

    await page.route(`**/api/collections/${collectionId}/stickers`, async (route) => {
      await requestReleased;
      await route.continue();
    });

    await page.goto(`/albums/${collectionId}`);
    await expect(page.getByRole("status")).toHaveText("Loading stickers…");
    await expectNoHorizontalOverflow(page);

    releaseRequest?.();
    await expect(page.getByRole("heading", { name: albumTitle })).toBeVisible();
    expect(await page.locator("li.sticker-row").count()).toBeGreaterThan(0);
  });
});
