// v6 — click .window-diff-row-head to expand + verify renderers
delete (process.env as any).http_proxy;
delete (process.env as any).HTTP_PROXY;
delete (process.env as any).https_proxy;
delete (process.env as any).HTTPS_PROXY;
process.env.NO_PROXY = "*";
import { chromium, type Page } from "playwright";
import { mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";

const SHOT_DIR = "/Users/zhangzhefu/x/ooc-2/ooc/docs/round-14-experience/screenshots";
const LOG = "/Users/zhangzhefu/x/ooc-2/ooc/docs/round-14-experience/run6.log";
mkdirSync(SHOT_DIR, { recursive: true });
writeFileSync(LOG, `--- v6 @ ${new Date().toISOString()} ---\n`);
function log(...a: unknown[]) { const s = a.map(x => typeof x === "string" ? x : JSON.stringify(x)).join(" "); console.log(s); appendFileSync(LOG, s + "\n"); }
async function shot(p: Page, n: string) { await p.screenshot({ path: join(SHOT_DIR, n + ".png"), fullPage: true }); log("[shot]", n); }
async function api(p: string) { const r = await fetch("http://localhost:3000" + p); return await r.json(); }

const SESSION_ID = process.env.SESSION || "_test_experience_1779878794073";

async function main() {
  const t = await api(`/api/flows/${SESSION_ID}/threads`);
  const TID = t.items.find((x: any) => x.objectId === "supervisor").threadId;

  const browser = await chromium.launch({ args: ["--no-proxy-server"] });
  const ctx = await browser.newContext({ viewport: { width: 1700, height: 1100 } });
  const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error") log("[err]", m.text().slice(0, 300)); });

  const url = `http://localhost:5173/flows/thread_context?sessionId=${SESSION_ID}&objectId=supervisor&threadId=${TID}`;
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
  await page.getByText("Loop Timeline", { exact: false }).first().click();
  await page.waitForTimeout(1500);

  // Latest = loop 10 by default
  const loopLabel = await page.locator(":text-matches('#\\\\d{4}')").first().innerText();
  log("starting loop:", loopLabel);

  // Click each window-diff-row-head
  const heads = page.locator(".window-diff-row-head");
  const hCount = await heads.count();
  log("head count:", hCount);
  for (let i = 0; i < hCount; i++) {
    try {
      await heads.nth(i).click({ timeout: 1500 });
      await page.waitForTimeout(500);
    } catch (e: any) { log("head click err", i, e?.message?.slice(0, 200)); }
  }
  await shot(page, "v6-01-latest-all-expanded");

  // Check renderer markup
  const cm = await page.locator(".cm-editor, .cm-merge, .cm-mergeView").count();
  log("CodeMirror DOM:", cm);
  for (const name of ["file-window-diff", "talk-window-diff", "command-exec-diff", "fallback-json-diff", "custom-window-diff"]) {
    const c = await page.locator(`[class*='${name}']`).count();
    log(`[class*=${name}]: ${c}`);
  }
  const expanded = page.locator(".window-diff-row-body");
  const eCount = await expanded.count();
  log("expanded bodies:", eCount);
  for (let i = 0; i < eCount; i++) {
    const text = await expanded.nth(i).innerText();
    log(`  body[${i}] (${text.length}c):`, text.slice(0, 200).replace(/\s+/g, " "));
  }

  // Navigate to loop 5 (where write_file was added → file_window introduced)
  for (let i = 0; i < 5; i++) {
    try {
      const prev = page.locator("button:has-text('Prev')").first();
      if (await prev.isEnabled()) {
        await prev.click({ timeout: 1500 });
        await page.waitForTimeout(400);
      }
    } catch {}
  }
  const loopLabel2 = await page.locator(":text-matches('#\\\\d{4}')").first().innerText();
  log("now loop:", loopLabel2);
  await page.waitForTimeout(700);

  const heads2 = page.locator(".window-diff-row-head");
  for (let i = 0; i < await heads2.count(); i++) {
    try { await heads2.nth(i).click({ timeout: 1500 }); await page.waitForTimeout(500); } catch {}
  }
  await shot(page, "v6-02-loop5-expanded");

  const cm2 = await page.locator(".cm-editor, .cm-merge, .cm-mergeView").count();
  log("CodeMirror at loop5:", cm2);
  for (const name of ["file-window-diff", "talk-window-diff", "command-exec-diff", "fallback-json-diff"]) {
    const c = await page.locator(`[class*='${name}']`).count();
    log(`  [${name}]: ${c}`);
  }
  // capture more text
  const bodies2 = page.locator(".window-diff-row-body");
  const eCount2 = await bodies2.count();
  for (let i = 0; i < eCount2; i++) {
    const html = await bodies2.nth(i).innerHTML();
    writeFileSync(join(SHOT_DIR, "..", `v6-loop5-body-${i}.html`), html.slice(0, 50_000));
  }
  log("dumped", eCount2, "loop5 bodies");

  // Now navigate to loop 4 (file added)
  try {
    const prev = page.locator("button:has-text('Prev')").first();
    if (await prev.isEnabled()) { await prev.click({ timeout: 1500 }); await page.waitForTimeout(700); }
  } catch {}
  const loopLabel3 = await page.locator(":text-matches('#\\\\d{4}')").first().innerText();
  log("now loop:", loopLabel3);

  const heads3 = page.locator(".window-diff-row-head");
  for (let i = 0; i < await heads3.count(); i++) {
    try { await heads3.nth(i).click({ timeout: 1500 }); await page.waitForTimeout(500); } catch {}
  }
  await shot(page, "v6-03-loop4-expanded");
  const cm3 = await page.locator(".cm-editor, .cm-merge, .cm-mergeView").count();
  log("CodeMirror at loop4:", cm3);

  // Direct test: in latest loop, even unchanged file_window — does FileWindowDiff render anything?
  // Looking at v6-02: file added in loop 5 should show "added" badge -> file renderer should show added content
  // Look in HTML
  const allHeads = await page.locator(".window-diff-row").allInnerTexts();
  log("all rows at loop4:");
  allHeads.forEach((t, i) => log(`  [${i}]:`, t.replace(/\s+/g, " ").slice(0, 200)));

  await browser.close();
  log("=== DONE ===");
}
main().catch(e => { log("[FATAL]", e?.message, e?.stack); process.exit(1); });
