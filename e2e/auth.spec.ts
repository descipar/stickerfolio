import { expect, test } from "@playwright/test";

import { credentials, expectNoHorizontalOverflow } from "./fixtures";

// The auth journey uses a fresh (unauthenticated) context so it can exercise the
// real sign-in form, an invalid attempt, and the forced first-admin password
// change. It deliberately performs few sign-ins to stay within the app's
// per-process rate limit.
test.use({ storageState: { cookies: [], origins: [] } });

test.describe("sign in", () => {
  test("login screen has no horizontal overflow and rejects bad credentials", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "Welcome to Stickerfolio" })).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await page.getByLabel("Email").fill(credentials.collector.email);
    await page.getByLabel("Password").fill("definitely-wrong-password");
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page.getByRole("alert")).toContainText("incorrect");
    // Still on the login screen after a failed attempt.
    await expect(page).toHaveURL(/\/login$/);
  });

  test("forces the first-admin to change the temporary password", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(credentials.firstAdmin.email);
    await page.getByLabel("Password").fill(credentials.firstAdmin.password);
    await page.getByRole("button", { name: "Sign in" }).click();

    // A restricted first-admin is routed to the mandatory password change.
    await page.waitForURL(/\/password\/change$/);
    await expect(page.getByRole("heading", { name: "Choose a new password" })).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await page.getByLabel("Current password").fill(credentials.firstAdmin.password);
    await page.getByLabel(/^New password/).fill("changed-admin-pass");
    await page.getByLabel("Confirm new password").fill("changed-admin-pass");
    await page.getByRole("button", { name: "Change password" }).click();

    // After the change the account is no longer stuck on the password screen or
    // bounced back to login.
    await page.waitForURL((url) => !/\/(password\/change|login)$/.test(url.pathname));
    expect(page.url()).not.toContain("/password/change");
    expect(page.url()).not.toContain("/login");
  });
});
