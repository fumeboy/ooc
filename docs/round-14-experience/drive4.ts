// Round 14 v4 — expand window-diff rows, verify CodeMirror Merge + per-type renderers
delete (process.env as any).http_proxy;
delete (process.env as any).HTTP_PROXY;
delete (process.env as any).https_proxy;
delete (process.env as any).HTTPS_PROXY;
process.env.NO_PROXY = "*";

import { chromium, type Page } from "playwright";
import { mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";

const SHOT_DIR = "/Users/zhangzhefu/x/ooc-2/ooc/docs/round-14-experience/screenshots";
const LOG = "/Users/zhangzhefu/x/ooc-2/ooc/docs/round-14-experience/run4.log";
mkdirSync(SHOT_DIR, { recursive: true });
writeFileSync(LOG, `--- v4 @ ${new Date().toISOString()} ---\n`);

function log(...a: unknown[]) {
  const s = a.map(x => typeof x === "string" ? x : JSON.stringify(x)).join(" ");
  console.log(s); appendFileSync(LOG, s + "\n");
}
async function shot(page: Page, name: string) {
  await page.screenshot({ path: join(SHOT_DIR, name + ".png"), fullPage: true });
  log("[shot]", name);
}
async function api(path: string) {
  const r = await fetch("http://localhost:3000" + path);
  return { status: r.status, body: await r.json() };
}

const SESSION_ID = process.env.SESSION || "_test_experience_1779878794073";

async function main() {
  const threadsRes = await api(`/api/flows/${SESSION_ID}/threads`);
  const supervisor = threadsRes.body?.items?.find((t: any) => t.objectId === "supervisor");
  const TID = supervisor.threadId;

  const browser = await chromium.launch({ args: ["--no-proxy-server"] });
  const ctx = await browser.newContext({ viewport: { width: 1700, height: 1100 } });
  const page = await ctx.newPage();

  page.on("console", (msg) => { if (msg.type() === "error") log("[console.error]", msg.text().slice(0, 300)); });
  page.on("pageerror", (e) => log("[pageerror]", e.message));

  const url = `http://localhost:5173/flows/thread_context?sessionId=${SESSION_ID}&objectId=supervisor&threadId=${TID}`;
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);

  await page.getByText("Loop Timeline", { exact: false }).first().click();
  await page.waitForTimeout(1500);
  await shot(page, "v4-01-tl-default");

  // Get the actual class of diff rows
  const candidates = [
    ".loop-window-diff-row",
    ".window-diff-row",
    "[data-testid*=window-diff]",
    "[role=button]",
  ];
  for (const sel of candidates) {
    const c = await page.locator(sel).count();
    log(`${sel}: ${c}`);
  }

  // Look at the actual DOM around a window row by inspecting innerHTML
  const html = await page.locator("text=/^talk$/i").first().locator("xpath=ancestor::*[contains(@class, 'row') or contains(@class, 'diff')][1]").innerHTML().catch(() => null);
  log("talk row inner html slice:", html?.slice(0, 800));

  // Try simpler: just click 'talk' label and see what expands
  // First check current loop
  const loopLabel = await page.locator(":text-matches('#\\\\d{4}')").first().innerText().catch(() => "?");
  log("current loop:", loopLabel);

  // Click "custom" label — the changed one
  log("=== click custom row ===");
  const customRow = page.locator("text=/^custom$/").first();
  if (await customRow.count()) {
    try {
      await customRow.click({ timeout: 1500 });
      await page.waitForTimeout(1500);
      await shot(page, "v4-02-custom-clicked");
    } catch (e: any) { log("custom click err:", e?.message?.slice(0, 200)); }
  }

  // Click expand caret if exists
  for (const caret of [".diff-row-toggle", "button[aria-label*=expand]", "button[aria-label*=展开]", "summary"]) {
    const c = await page.locator(caret).count();
    log(`caret ${caret}: ${c}`);
  }

  // Try a `summary` (HTML details/summary)
  const summaries = page.locator("summary");
  const sCount = await summaries.count();
  log("summary count:", sCount);
  for (let i = 0; i < sCount && i < 6; i++) {
    try {
      await summaries.nth(i).click({ timeout: 1500 });
      await page.waitForTimeout(800);
    } catch {}
  }
  await shot(page, "v4-03-after-summary-clicks");

  // Look for CodeMirror Merge rendered
  const cm = await page.locator(".cm-editor, .cm-merge, .cm-mergeView").count();
  log("CodeMirror elements:", cm);

  // Navigate to earlier loops where file changed
  // Click Prev many times
  for (let i = 0; i < 6; i++) {
    try {
      const prev = page.locator("button:has-text('Prev')").first();
      if (await prev.isEnabled()) {
        await prev.click({ timeout: 1500 });
        await page.waitForTimeout(500);
      }
    } catch {}
  }
  await shot(page, "v4-04-back-loop");

  // Expand all summaries here
  const sums2 = await page.locator("summary").count();
  log("summary count at earlier loop:", sums2);
  for (let i = 0; i < sums2 && i < 8; i++) {
    try {
      await page.locator("summary").nth(i).click({ timeout: 1500 });
      await page.waitForTimeout(500);
    } catch {}
  }
  await page.waitForTimeout(1500);
  await shot(page, "v4-05-all-expanded");

  const cm2 = await page.locator(".cm-editor, .cm-merge, .cm-mergeView").count();
  log("CodeMirror elements after expand:", cm2);

  // Try also class names from existing renderers
  for (const name of ["file-window-diff", "talk-window-diff", "plan-window-diff", "command-exec-diff", "fallback-json-diff"]) {
    const c = await page.locator(`[class*='${name}']`).count();
    log(`${name}: ${c}`);
  }

  // Look at end window if any
  const endWindows = await page.locator("[class*=command_exec], [class*=command-exec]").allInnerTexts();
  log("command-exec related:", endWindows.slice(0, 10));

  // Dump html of timeline panel
  const tl = await page.locator(":has-text('Loop Time Machine')").last().locator("xpath=ancestor::*[contains(@class, 'panel') or contains(@class, 'tab')][1]").innerHTML().catch(() => "");
  writeFileSync(join(SHOT_DIR, "..", "v4-timeline-panel.html"), tl);

  await shot(page, "v4-06-final");
  await browser.close();
  log("=== DONE ===");
}

main().catch((e) => { log("[FATAL]", e?.message, e?.stack); process.exit(1); });
