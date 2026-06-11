import { defineConfig, devices } from "@playwright/test";

/**
 * Frontend e2e — Playwright 配置。
 *
 * 详见 `docs/testing/oocable-codeagent-frontend-e2e.md`。
 *
 * 跑法（必须在 bun 下跑 playwright；bunx 解析为 node，会撞 builtin executable 的 bun-only import）：
 *   RUN_FRONTEND_E2E=1 bun node_modules/.bin/playwright test --config packages/@ooc/tests/e2e/frontend/playwright.config.ts
 *
 * 默认 skip（fixture 内根据 RUN_FRONTEND_E2E 与 .env 三件套判定）。
 * 串行（不 parallel），避免真 LLM 资源争抢。
 */
export default defineConfig({
  testDir: ".",
  // 用 .pw.ts 后缀让 `bun test` 默认匹配器（.test/.spec）忽略，避免冲突。
  testMatch: /.*\.pw\.ts$/,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["json", { outputFile: "playwright-report.json" }]] : "list",
  timeout: 300_000,
  expect: {
    timeout: 30_000,
  },
  use: {
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
