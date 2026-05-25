/**
 * Round 5 体验官 — v2 driver
 *
 * 改进:
 * - 浏览器走 noProxy（系统 Clash 拦截 localhost 502）
 * - 创建测试 session via curl 子进程而非 page.request
 * - 等待真实 DOM 渲染再拿 body 文本
 * - 切到 Loop Timeline 后多点 ui surface
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = "/Users/zhangzhefu/x/ooc-2/ooc/docs/round-5-experience";
const SHOTS = resolve(ROOT, "screenshots");
mkdirSync(SHOTS, { recursive: true });

const BASE = "http://localhost:5173";
const API = "http://localhost:3000";

const consoleErrors: { type: string; text: string; url: string }[] = [];
const netErrors: { url: string; status: number; method: string }[] = [];
const findings: string[] = [];
const sessionsCreated: string[] = [];

function log(m: string) { console.log(`[exp] ${m}`); findings.push(m); }

function curlJson(method: string, path: string, body?: any): { status: number; text: string } {
    const args = ["-s", "-o", "/tmp/curl-out.txt", "-w", "%{http_code}", "--noproxy", "*", "-X", method, `${API}${path}`];
    if (body !== undefined) {
        args.push("-H", "Content-Type: application/json", "-d", JSON.stringify(body));
    }
    const r = spawnSync("curl", args, { encoding: "utf8" });
    const status = Number(r.stdout || 0);
    const text = require("node:fs").readFileSync("/tmp/curl-out.txt", "utf8");
    return { status, text };
}

async function shoot(page: any, name: string) {
    await page.screenshot({ path: resolve(SHOTS, `${name}.png`), fullPage: false }).catch(() => {});
}

async function bodyText(page: any) {
    return await page.evaluate(() => document.body.innerText.slice(0, 3000));
}

async function main() {
    // Clear proxy env so chromium doesn't pick up Clash
    delete process.env.http_proxy;
    delete process.env.https_proxy;
    delete process.env.HTTP_PROXY;
    delete process.env.HTTPS_PROXY;
    delete process.env.all_proxy;
    delete process.env.ALL_PROXY;
    const browser = await chromium.launch({ headless: true, args: ["--no-proxy-server"] });
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();

    page.on("console", (m) => {
        if (m.type() === "error" || m.type() === "warning") {
            const text = m.text();
            if (text.includes("Download the React DevTools")) return;
            if (text.includes("[HMR]")) return;
            if (text.includes("Failed to load resource")) return; // already in netErrors
            consoleErrors.push({ type: m.type(), text, url: page.url() });
        }
    });
    page.on("pageerror", (e) => consoleErrors.push({ type: "pageerror", text: String(e), url: page.url() }));
    page.on("response", (r) => {
        if (r.status() >= 400) netErrors.push({ url: r.url(), status: r.status(), method: r.request().method() });
    });
    page.on("requestfailed", (r) => netErrors.push({ url: r.url(), status: 0, method: r.method() }));

    // ============ S1: home ============
    log("== S1 home + welcome ==");
    await page.goto(`${BASE}/`, { waitUntil: "networkidle", timeout: 15000 }).catch((e) => log(`home goto: ${e.message}`));
    await page.waitForTimeout(1200);
    await shoot(page, "s1-01-home");
    log("home body:\n" + (await bodyText(page)).slice(0, 800));

    await page.goto(`${BASE}/welcome`, { waitUntil: "networkidle", timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1000);
    await shoot(page, "s1-02-welcome");
    log("welcome body:\n" + (await bodyText(page)).slice(0, 600));

    // ============ S1b: flows list ============
    await page.goto(`${BASE}/flows`, { waitUntil: "networkidle", timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1000);
    await shoot(page, "s1-03-flows");
    log("flows body:\n" + (await bodyText(page)).slice(0, 600));

    // ============ S1c: existing session ============
    await page.goto(`${BASE}/flows/demo-2026-05-25-r11`, { waitUntil: "networkidle", timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1500);
    await shoot(page, "s1-04-session");
    log("session body:\n" + (await bodyText(page)).slice(0, 800));

    // ============ S1d: existing thread ============
    const threadUrl = `${BASE}/flows/demo-2026-05-25-r11/threads/supervisor/t_user_mpkj8hn2_5z6m`;
    await page.goto(threadUrl, { waitUntil: "networkidle", timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2500);
    await shoot(page, "s1-05-thread");
    log("thread body (head):\n" + (await bodyText(page)).slice(0, 1500));

    // capture all visible interactive elements with full detail
    const allInteractive = await page.evaluate(() => {
        const els = Array.from(document.querySelectorAll("button, [role=button], [role=tab], a[href], textarea, input"));
        return els.map((el: any) => ({
            tag: el.tagName.toLowerCase(),
            text: (el.innerText || el.textContent || "").trim().slice(0, 80),
            aria: el.getAttribute("aria-label") || "",
            title: el.getAttribute("title") || "",
            role: el.getAttribute("role") || "",
            disabled: el.disabled || el.getAttribute("aria-disabled") === "true",
        })).filter((x: any) => x.text || x.aria || x.title);
    });
    writeFileSync(resolve(ROOT, "thread-interactive.json"), JSON.stringify(allInteractive, null, 2));
    log(`thread interactive elements: ${allInteractive.length}`);

    // ============ S5: Loop Timeline tab ============
    log("== S5 Loop Timeline ==");
    const loopBtn = page.locator("button, [role=tab]").filter({ hasText: /Loop Timeline/ });
    if (await loopBtn.count() > 0) {
        await loopBtn.first().click({ timeout: 4000 }).catch((e) => log(`loop click: ${e.message}`));
        await page.waitForTimeout(1800);
        await shoot(page, "s5-01-loop");
        log("loop timeline body:\n" + (await bodyText(page)).slice(0, 1800));

        // look for enable-debug hint
        const eb = page.locator("button").filter({ hasText: /启用.*debug|enable.*debug/i });
        log(`enable-debug button count: ${await eb.count()}`);

        // look for badges (emojis ⏸️ ✅ ❌ 🍂 ⚠️ 📚)
        const badgeEmojis = await page.evaluate(() => {
            const text = document.body.innerText;
            const emojis = ["⏸️","✅","❌","🍂","⚠️","📚","🛠","🪟"];
            const result: Record<string, number> = {};
            for (const e of emojis) {
                const re = new RegExp(e, "g");
                const m = text.match(re);
                result[e] = m ? m.length : 0;
            }
            return result;
        });
        log(`badge emoji counts: ${JSON.stringify(badgeEmojis)}`);
    } else {
        log("[FINDING] no 'Loop Timeline' button found on thread page");
    }

    // ============ S1e: Context Snapshot ============
    const ctxSnap = page.locator("button, [role=tab]").filter({ hasText: /Context Snapshot/ });
    if (await ctxSnap.count() > 0) {
        await ctxSnap.first().click({ timeout: 4000 }).catch(() => {});
        await page.waitForTimeout(1500);
        await shoot(page, "s5-02-context-snapshot");
        log("context snapshot body:\n" + (await bodyText(page)).slice(0, 1200));
    }

    // ============ S6: stones / pools / world / stones/<obj> ============
    log("== S6 scopes ==");
    for (const route of ["/stones", "/pools", "/world", "/stones/supervisor", "/stones/feedback-tracker"]) {
        await page.goto(`${BASE}${route}`, { waitUntil: "networkidle", timeout: 12000 }).catch(() => {});
        await page.waitForTimeout(1000);
        const safe = route.replace(/[\/]/g, "_") || "_root";
        await shoot(page, `s6${safe}`);
        log(`${route} body:\n${(await bodyText(page)).slice(0, 500)}`);
    }

    // ============ S2: create new session, observe UI for it ============
    log("== S2 create test session ==");
    const ts = Date.now();
    const sid = `_test_experience_${ts}`;
    const cr = curlJson("POST", "/api/flows", { sessionId: sid, title: `Round 5 体验 ${ts}` });
    log(`create session status=${cr.status} body=${cr.text.slice(0, 300)}`);
    if (cr.status === 200 || cr.status === 201) sessionsCreated.push(sid);

    // open the new session
    await page.goto(`${BASE}/flows/${sid}`, { waitUntil: "networkidle", timeout: 12000 }).catch(() => {});
    await page.waitForTimeout(1500);
    await shoot(page, "s2-01-new-session");
    log(`new session body:\n${(await bodyText(page)).slice(0, 800)}`);

    // user/root thread (composer)
    await page.goto(`${BASE}/flows/${sid}/threads/user/root`, { waitUntil: "networkidle", timeout: 12000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await shoot(page, "s2-02-user-root");
    log(`user/root body:\n${(await bodyText(page)).slice(0, 1500)}`);

    const composers = await page.locator("textarea, [contenteditable=true]").count();
    log(`composers on user/root: ${composers}`);
    if (composers > 0) {
        const ta = page.locator("textarea, [contenteditable=true]").first();
        try {
            await ta.fill("打开 meta/object.doc.ts 看 thinkable 维度的结构");
            await shoot(page, "s2-03-composer-filled");
            log("composer fill OK");
            // try send via Enter or send button
            const sendBtn = page.locator("button").filter({ hasText: /^(send|发送|提交)$/i });
            const sc = await sendBtn.count();
            log(`exact send button count: ${sc}`);
            if (sc > 0) {
                await sendBtn.first().click({ timeout: 3000 }).catch((e) => log(`send click: ${e.message}`));
                await page.waitForTimeout(2500);
                await shoot(page, "s2-04-sent");
            } else {
                // try Ctrl+Enter
                await ta.press("Control+Enter").catch(() => {});
                await page.waitForTimeout(2500);
                await shoot(page, "s2-04-ctrl-enter");
            }
            log(`user/root body after send:\n${(await bodyText(page)).slice(0, 1500)}`);
        } catch (e: any) {
            log(`composer flow failed: ${e.message}`);
        }
    } else {
        log("[FINDING] no composer (textarea/contenteditable) on user/root — chat-from-user-home unreachable");
    }

    // ============ S6 extra: file viewer ============
    log("== S6 file viewer ==");
    await page.goto(`${BASE}/files/meta/object.doc.ts`, { waitUntil: "networkidle", timeout: 12000 }).catch(() => {});
    await page.waitForTimeout(1500);
    await shoot(page, "s6-files-meta-object");
    log(`/files/meta/object.doc.ts body:\n${(await bodyText(page)).slice(0, 800)}`);

    await page.goto(`${BASE}/files/nonexistent/file.md`, { waitUntil: "networkidle", timeout: 12000 }).catch(() => {});
    await page.waitForTimeout(1000);
    await shoot(page, "s6-files-404");
    log(`/files/nonexistent body:\n${(await bodyText(page)).slice(0, 500)}`);

    // ============ S6: issues page ============
    await page.goto(`${BASE}/flows/demo-2026-05-25-r11/issues`, { waitUntil: "networkidle", timeout: 12000 }).catch(() => {});
    await page.waitForTimeout(1500);
    await shoot(page, "s6-issues");
    log(`issues body:\n${(await bodyText(page)).slice(0, 600)}`);

    await ctx.close();
    await browser.close();

    // cleanup created sessions
    log("== Cleanup ==");
    for (const sid of sessionsCreated) {
        try {
            rmSync(resolve("/Users/zhangzhefu/x/ooc-2/ooc/.ooc-world/flows", sid), { recursive: true, force: true });
            log(`removed flows/${sid}`);
        } catch (e: any) { log(`rm fail ${sid}: ${e.message}`); }
    }

    writeFileSync(resolve(ROOT, "playwright-v2-raw.json"), JSON.stringify({ consoleErrors, netErrors, findings, sessionsCreated }, null, 2));
    log(`consoleErrors=${consoleErrors.length} netErrors=${netErrors.length}`);
}

main().catch((e) => { console.error("FATAL", e); process.exit(1); });
