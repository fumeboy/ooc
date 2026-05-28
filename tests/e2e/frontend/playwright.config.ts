import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for OOC-3 frontend e2e tests.
 *
 * Run: RUN_FRONTEND_E2E=1 bunx playwright test --config tests/e2e/frontend/playwright.config.ts
 *
 * Requires:
 *   - OOC_API_KEY (or ANTHROPIC_API_KEY) for real-LLM tests
 *   - Backend started separately OR via globalSetup
 */
export default defineConfig({
    testDir: ".",
    testMatch: "**/*.playwright.test.ts",
    timeout: 60_000,
    retries: 0,
    reporter: [["list"]],
    use: {
        baseURL: process.env.VITE_BASE_URL ?? "http://localhost:5174",
        trace: "on-first-retry",
        screenshot: "only-on-failure",
    },
    projects: [
        {
            name: "chromium",
            use: { ...devices["Desktop Chrome"] },
        },
    ],
});
