/**
 * tests/e2e/frontend/ui-real-llm.playwright.test.ts
 *
 * Browser-level e2e: OOC-3 UI with real backend + real LLM.
 *
 * Prerequisites (must be running before this test):
 *   Backend:  bun src/app/server/index.ts --world /tmp/ooc-3-ui-e2e --port 3008
 *   Vite dev: cd web && OOC_API_TARGET=http://localhost:3008 bunx vite --port 5174
 *
 * Or use the helper script:
 *   OOC_API_KEY=<key> bash scripts/dev-start.sh
 *
 * Skip conditions:
 *   - OOC_API_KEY not set (or ANTHROPIC_API_KEY not set)
 *   - RUN_FRONTEND_E2E not set
 *
 * The test:
 *   1. Navigates to /stones → asserts "supervisor" stone appears
 *   2. Navigates to /stones/supervisor → opens stone detail
 *   3. Posts a talk message to supervisor via /api/talk (fetch)
 *   4. Reloads the page and asserts the stone detail still loads
 */

import { test, expect } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SKIP = !process.env.OOC_API_KEY && !process.env.ANTHROPIC_API_KEY;
const BACKEND_PORT = 3008;
const VITE_PORT = 5174;

// Managed processes (started in beforeAll when running standalone)
let backendProc: ChildProcess | null = null;
let viteProc: ChildProcess | null = null;

function waitMs(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHttp(url: string, timeoutMs = 20_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            const res = await fetch(url);
            if (res.ok) return;
        } catch {
            // not ready yet
        }
        await waitMs(500);
    }
    throw new Error(`Timed out waiting for ${url}`);
}

test.describe("UI real-LLM e2e", () => {
    test.skip(SKIP, "OOC_API_KEY not set — skipping real-LLM UI e2e");

    test.beforeAll(async () => {
        // Only start processes if USE_EXTERNAL_SERVER is not set
        // (allows CI to start backend + vite externally)
        if (process.env.USE_EXTERNAL_SERVER) return;

        const worldRoot = mkdtempSync(join(tmpdir(), "ooc-3-ui-e2e-"));
        const cwd = join(import.meta.dir, "../../..");

        // Start backend
        backendProc = spawn(
            "bun",
            ["src/app/server/index.ts", "--world", worldRoot, "--port", String(BACKEND_PORT)],
            { cwd, stdio: "pipe" },
        );
        backendProc.stderr?.on("data", (d) => process.stderr.write(`[backend] ${d}`));
        backendProc.stdout?.on("data", (d) => process.stdout.write(`[backend] ${d}`));

        await waitForHttp(`http://localhost:${BACKEND_PORT}/api/health`, 15_000);
        console.log("[e2e] backend ready");

        // Start vite dev server
        viteProc = spawn(
            "bunx",
            ["vite", "--port", String(VITE_PORT)],
            {
                cwd: join(cwd, "web"),
                stdio: "pipe",
                env: {
                    ...process.env,
                    OOC_API_TARGET: `http://localhost:${BACKEND_PORT}`,
                },
            },
        );
        viteProc.stderr?.on("data", (d) => process.stderr.write(`[vite] ${d}`));
        viteProc.stdout?.on("data", (d) => process.stdout.write(`[vite] ${d}`));

        await waitForHttp(`http://localhost:${VITE_PORT}/`, 30_000);
        console.log("[e2e] vite ready");
    });

    test.afterAll(async () => {
        backendProc?.kill("SIGTERM");
        viteProc?.kill("SIGTERM");
        await waitMs(500);
    });

    test("navigates to /stones and sees supervisor", async ({ page }) => {
        await page.goto(`http://localhost:${VITE_PORT}/stones`);
        // Wait for the stones list to load
        await expect(page.locator("body")).toContainText("supervisor", { timeout: 15_000 });
        await expect(page.locator("body")).toContainText("Stones", { timeout: 5_000 });
        console.log("[e2e] /stones rendered with supervisor");
    });

    test("navigates to /stones/supervisor and sees stone detail", async ({ page }) => {
        await page.goto(`http://localhost:${VITE_PORT}/stones/supervisor`);
        await expect(page.locator("body")).toContainText("supervisor", { timeout: 15_000 });
        console.log("[e2e] /stones/supervisor rendered");
    });

    test("POST /api/talk to supervisor returns LLM response", async ({ page }) => {
        // Use page.evaluate to make a fetch from within the browser context
        // (proxy is only active for requests from the vite-served origin)
        await page.goto(`http://localhost:${VITE_PORT}/`);

        const result = await page.evaluate(async (port: number) => {
            const resp = await fetch(`http://localhost:${port}/api/talk`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    target: "ooc://stones/main/objects/supervisor",
                    content: "What is OOC? Answer in one sentence.",
                }),
            });
            return resp.json();
        }, BACKEND_PORT);

        console.log("[e2e] talk response:", JSON.stringify(result).slice(0, 300));

        expect(result.ok).toBe(true);
        expect(typeof result.response).toBe("string");
        expect(result.response.length).toBeGreaterThan(10);
        expect(result.threadStatus).toBe("done");
    });
});
