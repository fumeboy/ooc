// v5 — click the actual expand buttons (aria-label=展开)
delete (process.env as any).http_proxy;
delete (process.env as any).HTTP_PROXY;
delete (process.env as any).https_proxy;
delete (process.env as any).HTTPS_PROXY;
process.env.NO_PROXY = "*";

import { chromium, type Page } from "playwright";
import { mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";

const SHOT_DIR = "/Users/zhangzhefu/x/ooc-2/ooc/docs/round-14-experience/screenshots";
const LOG = "/Users/zhangzhefu/x/ooc-2/ooc/docs/round-14-experience/run5.log";
mkdirSync(SHOT_DIR, { recursive: true });
writeFileSync(LOG, `--- v5 @ ${new Date().toISOString()} ---\n`);
function log(...a: unknown[]) { const s = a.map(x => typeof x === "string" ? x : JSON.stringify(x)).join(" "); console.log(s); appendFileSync(LOG, s + "\n"); }
async function shot(page: Page, name: string) { await page.screenshot({ path: join(SHOT_DIR, name + ".png"), fullPage: true }); log("[shot]", name); }
async function api(p: string) { const r = await fetch("http://localhost:3000" + p); return await r.json(); }

const SESSION_ID = process.env.SESSION || "_test_experience_1779878794073";

async function main() {
  const t = await api(`/api/flows/${SESSION_ID}/threads`);
  const sup = t.items.find((x: any) => x.objectId === "supervisor");
  const TID = sup.threadId;

  const browser = await chromium.launch({ args: ["--no-proxy-server"] });
  const ctx = await browser.newContext({ viewport: { width: 1700, height: 1100 } });
  const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error") log("[err]", m.text().slice(0, 300)); });

  const url = `http://localhost:5173/flows/thread_context?sessionId=${SESSION_ID}&objectId=supervisor&threadId=${TID}`;
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);

  await page.getByText("Loop Timeline", { exact: false }).first().click();
  await page.waitForTimeout(1500);

  // Try navigating to loop 5 (file just added)
  // Latest = loop 10. Click Prev 5 times to reach loop 5.
  for (let i = 0; i < 5; i++) {
    try {
      const prev = page.locator("button:has-text('Prev')").first();
      if (await prev.isEnabled()) {
        await prev.click({ timeout: 1500 });
        await page.waitForTimeout(400);
      }
    } catch {}
  }
  const loopLabel = await page.locator(":text-matches('#\\\\d{4}')").first().innerText().catch(() => "?");
  log("current loop:", loopLabel);
  await shot(page, "v5-01-loop5");

  // Get all expand buttons
  const expand = page.locator("button[aria-label*=展开]");
  const cnt = await expand.count();
  log("expand button count:", cnt);

  for (let i = 0; i < cnt; i++) {
    try {
      const btn = expand.nth(i);
      const aria = await btn.getAttribute("aria-label");
      log(`expand[${i}] aria=${aria}`);
    } catch {}
  }

  // Click each in sequence
  for (let i = 0; i < cnt; i++) {
    try {
      await expand.nth(i).click({ timeout: 1500 });
      await page.waitForTimeout(700);
    } catch (e: any) { log("expand click err", i, e?.message?.slice(0, 200)); }
  }
  await shot(page, "v5-02-all-expanded-loop5");

  // Check renderer presence
  for (const name of ["file-window-diff", "talk-window-diff", "plan-window-diff", "command-exec-diff", "fallback-json-diff", "knowledge-window-diff", "search-window-diff", "do-window-diff"]) {
    const c = await page.locator(`[class*='${name}']`).count();
    log(`${name}: ${c}`);
  }
  const cm = await page.locator(".cm-editor, .cm-mergeView, .cm-merge").count();
  log("CodeMirror DOM count:", cm);

  // Check 'changed' and 'added' rows
  const changedRows = await page.locator(":has(.window-diff-row-pill-changed)").count();
  const addedRows = await page.locator(":has(.window-diff-row-pill-added)").count();
  log("changed/added rows:", changedRows, addedRows);

  // Look at text content - dump
  const expandedRegions = await page.locator(".window-diff-row-content, .window-diff-detail, [class*=diff-content]").allInnerTexts();
  log("expanded text count:", expandedRegions.length);
  expandedRegions.forEach((t, i) => log(`  expanded[${i}]:`, t.slice(0, 200)));

  // Take a wide screenshot
  await shot(page, "v5-03-expansion-detail");

  // Navigate to loop 4 (where file was first added)
  for (let i = 0; i < 1; i++) {
    try { await page.locator("button:has-text('Prev')").first().click({ timeout: 1500 }); await page.waitForTimeout(500); } catch {}
  }
  await shot(page, "v5-04-loop4");
  const loopLabel2 = await page.locator(":text-matches('#\\\\d{4}')").first().innerText().catch(() => "?");
  log("loop now:", loopLabel2);

  const expand2 = page.locator("button[aria-label*=展开]");
  const cnt2 = await expand2.count();
  log("expand on loop4:", cnt2);
  for (let i = 0; i < cnt2; i++) {
    try { await expand2.nth(i).click({ timeout: 1500 }); await page.waitForTimeout(500); } catch {}
  }
  await shot(page, "v5-05-loop4-expanded");

  // CodeMirror?
  const cm3 = await page.locator(".cm-editor, .cm-mergeView, .cm-merge").count();
  log("CM on loop4:", cm3);
  for (const name of ["file-window-diff", "talk-window-diff", "command-exec-diff", "fallback-json-diff"]) {
    const c = await page.locator(`[class*='${name}']`).count();
    log(`${name}: ${c}`);
  }

  // Try go up to latest, look at full rendering
  try { await page.locator("button:has-text('Latest')").first().click({ timeout: 1500 }); await page.waitForTimeout(800); } catch {}
  const expand3 = page.locator("button[aria-label*=展开]");
  for (let i = 0; i < await expand3.count(); i++) {
    try { await expand3.nth(i).click({ timeout: 1500 }); await page.waitForTimeout(500); } catch {}
  }
  await shot(page, "v5-06-latest-expanded");

  // Dump HTML for inspection
  const tlHtml = await page.locator(".loop-time-machine, [class*='loop-time-machine']").first().innerHTML().catch(async () => {
    return await page.locator(":has-text('Loop Time Machine')").last().locator("xpath=ancestor::section[1]|xpath=ancestor::div[contains(@class, 'panel')][1]").innerHTML().catch(() => "");
  });
  writeFileSync(join(SHOT_DIR, "..", "v5-timeline-html.html"), tlHtml.slice(0, 200_000));

  await browser.close();
  log("=== DONE ===");
}

main().catch((e) => { log("[FATAL]", e?.message, e?.stack); process.exit(1); });
