import { defineConfig, devices } from "@playwright/test";

/**
 * Mobile MVP acceptance suite (GitHub issue #44).
 *
 * The whole suite runs at the iPhone 13 viewport (390x844) in Chromium, the
 * primary mobile target from the roadmap. `baseURL` comes from the environment
 * so the same suite can point at a locally started app or a CI-started one.
 */
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3500";

// iPhone 13 logical viewport. Chromium is used (rather than the WebKit device
// descriptor) because CI installs the Chromium browser and because mobile
// emulation flags (isMobile / hasTouch) are supported there.
const iPhone13 = {
  ...devices["Desktop Chrome"],
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
};

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  // Shared PostgreSQL state and the app's per-process sign-in rate limit make a
  // single worker the deterministic choice for this acceptance suite.
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  globalSetup: "./e2e/global-setup.ts",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    ...iPhone13,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "mobile-chromium", use: {} },
  ],
  webServer: {
    command: "pnpm start",
    url: `${baseURL}/api/health/ready`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
