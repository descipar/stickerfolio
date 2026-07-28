import { expect, test } from "@playwright/test";

import { albumTitle, expectNoHorizontalOverflow, storageStatePaths } from "./fixtures";

// Runs as the freshly-registered collector who has not completed onboarding.
test.use({ storageState: storageStatePaths.newcomer });

test.describe("onboarding", () => {
  test("sets a display name, picks an album, and lands in the album view", async ({ page }) => {
    await page.goto("/onboarding");

    await expect(page.getByRole("heading", { name: "Confirm your display name" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Choose your albums" })).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await page.getByLabel("Display name").fill("Mobile Tester");

    // The published catalog album is selectable via its card checkbox (no
    // hover needed: a direct tap toggles selection).
    const albumCard = page.locator("label.album-card", { hasText: albumTitle });
    await expect(albumCard).toBeVisible();
    await albumCard.getByRole("checkbox").check();
    await expect(albumCard.getByRole("checkbox")).toBeChecked();

    await page.getByRole("button", { name: /Start collecting/ }).click();

    // Lands directly inside the newly created album collection.
    await page.waitForURL(/\/albums\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { name: albumTitle })).toBeVisible();
    await expectNoHorizontalOverflow(page);

    // The trade partner overview is reachable and, since this collector has not
    // opted in, shows the private (empty) state deterministically.
    const collectionId = new URL(page.url()).pathname.split("/")[2];
    await page.goto(`/albums/${collectionId}/trades`);
    await expect(page.getByRole("heading", { name: "Trading is private" })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
});
