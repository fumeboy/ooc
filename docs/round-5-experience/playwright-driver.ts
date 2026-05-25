/**
 * Round 5 体验官 Playwright driver
 *
 * 用 chromium-headless-shell 跑 Web UI 的探索性体验。
 * 输出截图 + 控制台错误日志 + 网络错误日志。
 */
import { chromium, type ConsoleMessage, type Request, type Response } from "playwright";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = "/Users/zhangzhefu/x/ooc-2/ooc/docs/round-5-experience";
const SHOTS = resolve(ROOT, "screenshots");
mkdirSync(SHOTS, { recursive: true });

const BASE = "http://localhost:5173";
const consoleErrors: { type: string; text: string; url: string }[] = [];
const netErrors: { url: string; status: number; method: string }[] = [];
const findings: string[] = [];

function log(msg: string) {
    console.log(`[exp] ${msg}`);
    findings.push(msg);
}

async function shoot(page: any, name: string) {
    const file = resolve(SHOTS, `${name}.png`);
    await page.screenshot({ path: file, fullPage: false }).catch((e: any) => log(`[shoot-fail] ${name}: ${e.message}`));
    return file;
}

async function main() {
    const browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();

    page.on("console", (m: ConsoleMessage) => {
        if (m.type() === "error" || m.type() === "warning") {
            const text = m.text();
            // filter react devtools / vite hmr warnings
            if (text.includes("Download the React DevTools")) return;
            if (text.includes("[HMR]")) return;
            consoleErrors.push({ type: m.type(), text, url: page.url() });
        }
    });
    page.on("pageerror", (e) => {
        consoleErrors.push({ type: "pageerror", text: String(e), url: page.url() });
    });
    page.on("response", (r: Response) => {
        if (r.status() >= 400) {
            netErrors.push({ url: r.url(), status: r.status(), method: r.request().method() });
        }
    });
    page.on("requestfailed", (r: Request) => {
        netErrors.push({ url: r.url(), status: 0, method: r.method() });
    });

    // ============ Scenario 1: 首页 + welcome / 现有 session 浏览 ============
    log("== Scenario 1: home page + browse existing session ==");
    await page.goto(`${BASE}/`, { waitUntil: "networkidle", timeout: 15000 }).catch((e) => log(`goto / failed: ${e.message}`));
    await page.waitForTimeout(800);
    await shoot(page, "s1-01-home");

    // Capture sidebar/structure
    const bodyText1 = await page.evaluate(() => document.body.innerText.slice(0, 3000));
    log(`home body preview:\n${bodyText1.slice(0, 600)}`);

    // navigate to flows list
    await page.goto(`${BASE}/flows`, { waitUntil: "networkidle", timeout: 15000 }).catch((e) => log(`goto /flows: ${e.message}`));
    await page.waitForTimeout(600);
    await shoot(page, "s1-02-flows");
    const flowsText = await page.evaluate(() => document.body.innerText.slice(0, 1500));
    log(`flows body preview:\n${flowsText.slice(0, 400)}`);

    // navigate to existing session
    await page.goto(`${BASE}/flows/demo-2026-05-25-r11`, { waitUntil: "networkidle", timeout: 15000 }).catch((e) => log(`goto session: ${e.message}`));
    await page.waitForTimeout(800);
    await shoot(page, "s1-03-session");
    const sessText = await page.evaluate(() => document.body.innerText.slice(0, 2000));
    log(`session body preview:\n${sessText.slice(0, 600)}`);

    // navigate to existing thread (supervisor)
    await page.goto(`${BASE}/flows/demo-2026-05-25-r11/threads/supervisor/t_user_mpkj8hn2_5z6m`, { waitUntil: "networkidle", timeout: 15000 }).catch((e) => log(`goto thread: ${e.message}`));
    await page.waitForTimeout(1500);
    await shoot(page, "s1-04-thread");

    // Capture tab/feature surface
    const tabsText = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll("button, [role=tab], a"));
        return buttons.map((b: any) => (b.innerText || b.textContent || "").trim()).filter((t: string) => t && t.length < 60).slice(0, 80);
    });
    log(`thread visible interactive elements (sample): ${JSON.stringify(tabsText.slice(0, 40))}`);

    // ============ Scenario 5: Loop Timeline tab ============
    log("== Scenario 5: Loop Timeline tab ==");

    // try to find a tab named "Loop" or "Timeline"
    const loopTabLocator = page.locator("button, [role=tab]").filter({ hasText: /loop|timeline/i });
    const loopCount = await loopTabLocator.count();
    log(`loop/timeline tab count: ${loopCount}`);
    if (loopCount > 0) {
        try {
            await loopTabLocator.first().click({ timeout: 4000 });
            await page.waitForTimeout(1500);
            await shoot(page, "s5-01-loop-timeline");
            const ttext = await page.evaluate(() => document.body.innerText.slice(0, 3000));
            log(`loop timeline body preview:\n${ttext.slice(0, 1200)}`);
        } catch (e: any) {
            log(`loop tab click failed: ${e.message}`);
        }
    } else {
        log("[FINDING] no Loop Timeline tab visible by text 'loop'/'timeline' — Round 4 P1-3 reach surface unclear");
    }

    // Look for "启用 debug" button (degenerate mode hint)
    const enableDebug = page.locator("button").filter({ hasText: /启用.*debug|enable.*debug/i });
    const edCount = await enableDebug.count();
    log(`enable-debug button count on timeline: ${edCount}`);
    if (edCount > 0) {
        await shoot(page, "s5-02-debug-hint");
    }

    // ============ Scenario 6: explore stones / pools / world ============
    log("== Scenario 6: stones / pools / world ==");
    for (const route of ["/stones", "/pools", "/world", "/stones/supervisor"]) {
        await page.goto(`${BASE}${route}`, { waitUntil: "networkidle", timeout: 12000 }).catch((e) => log(`goto ${route}: ${e.message}`));
        await page.waitForTimeout(700);
        const safe = route.replace(/[\/]/g, "_") || "_root";
        await shoot(page, `s6-${safe}`);
        const t = await page.evaluate(() => document.body.innerText.slice(0, 800));
        log(`${route} body preview:\n${t.slice(0, 300)}`);
    }

    // ============ Scenario 2: try to create new session via API + open in UI ============
    log("== Scenario 2: create test session via API + open ==");
    const ts = Date.now();
    const testSid = `_test_experience_${ts}`;

    // create session via POST /api/flows (or /api/sessions?). Check what exists.
    const createResp = await page.request.post(`${BASE}/api/flows`, {
        data: { sessionId: testSid, title: `Round 5 体验 ${ts}` },
        failOnStatusCode: false,
    }).catch((e) => null);
    if (createResp) {
        log(`POST /api/flows status=${createResp.status()} body=${(await createResp.text()).slice(0, 400)}`);
    } else {
        log("POST /api/flows threw");
    }

    // navigate to the new session if created
    await page.goto(`${BASE}/flows/${testSid}`, { waitUntil: "networkidle", timeout: 12000 }).catch((e) => log(`goto new session: ${e.message}`));
    await page.waitForTimeout(800);
    await shoot(page, "s2-01-new-session");

    // ============ Scenario 7-light: try to find a composer / chat input ============
    log("== Scenario 7-light: find chat composer on user home ==");
    await page.goto(`${BASE}/flows/${testSid}/threads/user/root`, { waitUntil: "networkidle", timeout: 12000 }).catch((e) => log(`goto user thread: ${e.message}`));
    await page.waitForTimeout(1200);
    await shoot(page, "s7-01-user-thread");

    const composers = await page.locator("textarea, [contenteditable=true], input[type=text]").count();
    log(`composer-like elements on user thread: ${composers}`);

    if (composers > 0) {
        const ta = page.locator("textarea, [contenteditable=true]").first();
        try {
            await ta.fill("打开 meta/object.doc.ts 看 thinkable 维度");
            await shoot(page, "s7-02-filled");
            log("composer fill OK");
            // try send
            const sendBtn = page.locator("button").filter({ hasText: /send|发送|提交/i });
            const sc = await sendBtn.count();
            log(`send button count: ${sc}`);
            if (sc > 0) {
                await sendBtn.first().click({ timeout: 3000 }).catch((e) => log(`send click failed: ${e.message}`));
                await page.waitForTimeout(1500);
                await shoot(page, "s7-03-sent");
            }
        } catch (e: any) {
            log(`composer fill failed: ${e.message}`);
        }
    }

    // ============ Scenario 6: dead clicks / hover survey ============
    log("== Scenario 6 extra: survey all buttons for accessibility/labels ==");
    await page.goto(`${BASE}/flows/demo-2026-05-25-r11/threads/supervisor/t_user_mpkj8hn2_5z6m`, { waitUntil: "networkidle", timeout: 12000 }).catch((e) => log(`goto demo thread: ${e.message}`));
    await page.waitForTimeout(1200);

    const interactive = await page.evaluate(() => {
        const els = Array.from(document.querySelectorAll("button, [role=button], [role=tab], a[href]"));
        return els.slice(0, 100).map((el: any) => ({
            tag: el.tagName.toLowerCase(),
            text: (el.innerText || el.textContent || "").trim().slice(0, 80),
            aria: el.getAttribute("aria-label") || "",
            title: el.getAttribute("title") || "",
            disabled: el.disabled || false,
        })).filter((x) => x.text || x.aria || x.title);
    });
    log(`interactive elements on demo thread (${interactive.length}):\n${JSON.stringify(interactive.slice(0, 30), null, 2)}`);

    // close
    await ctx.close();
    await browser.close();

    // ============ Cleanup test session ============
    log("== Cleanup ==");

    // dump findings
    const report = {
        consoleErrors,
        netErrors,
        findings,
    };
    writeFileSync(resolve(ROOT, "playwright-raw-log.json"), JSON.stringify(report, null, 2));
    log(`Wrote raw log: ${ROOT}/playwright-raw-log.json`);
    log(`consoleErrors=${consoleErrors.length} netErrors=${netErrors.length}`);
    if (consoleErrors.length) console.log("CONSOLE_ERRORS:", JSON.stringify(consoleErrors.slice(0, 20), null, 2));
    if (netErrors.length) console.log("NET_ERRORS:", JSON.stringify(netErrors.slice(0, 20), null, 2));
}

main().catch((e) => {
    console.error("DRIVER FATAL:", e);
    process.exit(1);
});
