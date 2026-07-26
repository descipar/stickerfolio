import { expect, test } from "@playwright/test";

import {
  credentials,
  expectNoHorizontalOverflow,
  readSeededState,
  storageStatePaths,
} from "./fixtures";

test.use({ storageState: storageStatePaths.collector });

test.describe("trade partner overview", () => {
  test.beforeEach(async ({ page }) => {
    const { collectionId } = readSeededState();
    await page.goto(`/albums/${collectionId}/trades`);
    await expect(page.getByRole("heading", { name: "Trade partners" })).toBeVisible();
  });

  test("lists at least one partner without horizontal overflow", async ({ page }) => {
    await expect(page.getByRole("button", { name: new RegExp(credentials.partner.displayName) })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test("expands and collapses a partner's details on tap, without hover", async ({ page }) => {
    const toggle = page.getByRole("button", { name: new RegExp(credentials.partner.displayName) });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByRole("heading", { name: /They can offer you/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: /You can offer them/ })).toBeVisible();

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  test("expands a long sticker group with the show-all control", async ({ page }) => {
    const toggle = page.getByRole("button", { name: new RegExp(credentials.partner.displayName) });
    await toggle.click();

    const showAll = page.getByRole("button", { name: /Show all/ });
    await expect(showAll).toBeVisible();
    await showAll.click();
    await expect(page.getByRole("button", { name: "Show fewer" })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test("filters to two-way matches and keeps the partner visible", async ({ page }) => {
    await page.getByLabel("Match type").selectOption("two-way");
    await expect(page.getByRole("button", { name: new RegExp(credentials.partner.displayName) })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
});
