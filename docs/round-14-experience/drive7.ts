// v7 — wait for loop fetch to complete & check rendered diff content
delete (process.env as any).http_proxy;
delete (process.env as any).HTTP_PROXY;
delete (process.env as any).https_proxy;
delete (process.env as any).HTTPS_PROXY;
process.env.NO_PROXY = "*";
import { chromium, type Page } from "playwright";
import { mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";

const SHOT_DIR = "/Users/zhangzhefu/x/ooc-2/ooc/docs/round-14-experience/screenshots";
const LOG = "/Users/zhangzhefu/x/ooc-2/ooc/docs/round-14-experience/run7.log";
mkdirSync(SHOT_DIR, { recursive: true });
writeFileSync(LOG, `--- v7 @ ${new Date().toISOString()} ---\n`);
function log(...a: unknown[]) { const s = a.map(x => typeof x === "string" ? x : JSON.stringify(x)).join(" "); console.log(s); appendFileSync(LOG, s + "\n"); }
async function shot(p: Page, n: string) { await p.screenshot({ path: join(SHOT_DIR, n + ".png"), fullPage: true }); log("[shot]", n); }
async function api(p: string) { const r = await fetch("http://localhost:3000" + p); return await r.json(); }

const SESSION_ID = process.env.SESSION || "_test_experience_1779878794073";

async function main() {
  const t = await api(`/api/flows/${SESSION_ID}/threads`);
  const TID = t.items.find((x: any) => x.objectId === "supervisor").threadId;
  log("session:", SESSION_ID, "TID:", TID);

  const browser = await chromium.launch({ args: ["--no-proxy-server"] });
  const ctx = await browser.newContext({ viewport: { width: 1700, height: 1100 } });
  const page = await ctx.newPage();
  page.on("console", (m) => { log("[console]", m.type(), m.text().slice(0, 300)); });
  page.on("requestfailed", (r) => log("[net failed]", r.url(), r.failure()?.errorText));
  page.on("response", (r) => {
    if (r.url().includes("loop")) log("[resp]", r.status(), r.url().slice(-100));
  });

  const url = `http://localhost:5173/flows/thread_context?sessionId=${SESSION_ID}&objectId=supervisor&threadId=${TID}`;
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
  await page.getByText("Loop Timeline", { exact: false }).first().click();
  await page.waitForTimeout(1500);

  // Latest loop (10) — click custom row (changed)
  const heads = page.locator(".window-diff-row-head");
  log("rows:", await heads.count());

  // Click custom (row index 1)
  await heads.nth(1).click();
  await page.waitForTimeout(4000);
  await shot(page, "v7-01-custom-clicked-wait4s");

  // Check body
  const body = page.locator(".window-diff-row-body");
  if (await body.count() > 0) {
    const txt = await body.first().innerText();
    log("body[0] (after 4s):", txt.length, "chars:", txt.slice(0, 300));
    writeFileSync(join(SHOT_DIR, "..", "v7-custom-body.html"), await body.first().innerHTML());
  }

  // Try file row (row 2)
  // First close existing
  await heads.nth(1).click();
  await page.waitForTimeout(300);
  await heads.nth(2).click();
  await page.waitForTimeout(4000);
  await shot(page, "v7-02-file-clicked");
  const body2 = page.locator(".window-diff-row-body");
  if (await body2.count() > 0) {
    const txt = await body2.first().innerText();
    log("file body:", txt.length, "chars:", txt.slice(0, 300));
    writeFileSync(join(SHOT_DIR, "..", "v7-file-body.html"), await body2.first().innerHTML());
  }
  // CodeMirror?
  log("CM:", await page.locator(".cm-editor, .cm-merge, .cm-mergeView").count());

  // Try talk row (0)
  await heads.nth(2).click();
  await page.waitForTimeout(300);
  await heads.nth(0).click();
  await page.waitForTimeout(4000);
  await shot(page, "v7-03-talk-clicked");
  const body3 = page.locator(".window-diff-row-body");
  if (await body3.count() > 0) {
    writeFileSync(join(SHOT_DIR, "..", "v7-talk-body.html"), await body3.first().innerHTML());
    log("talk body chars:", (await body3.first().innerText()).length);
  }

  // Try command_exec row (3 or 4)
  await heads.nth(0).click();
  await page.waitForTimeout(300);
  await heads.nth(3).click();
  await page.waitForTimeout(4000);
  await shot(page, "v7-04-command-exec-clicked");
  const body4 = page.locator(".window-diff-row-body");
  if (await body4.count() > 0) {
    writeFileSync(join(SHOT_DIR, "..", "v7-cmd-body.html"), await body4.first().innerHTML());
    log("cmd body chars:", (await body4.first().innerText()).length);
  }

  // Now go to loop 5 (file added) and click file
  for (let i = 0; i < 5; i++) {
    try {
      const prev = page.locator("button:has-text('Prev')").first();
      if (await prev.isEnabled()) { await prev.click(); await page.waitForTimeout(400); }
    } catch {}
  }
  await page.waitForTimeout(500);
  const heads5 = page.locator(".window-diff-row-head");
  log("loop5 rows:", await heads5.count());
  await heads5.nth(2).click(); // file row
  await page.waitForTimeout(5000);
  await shot(page, "v7-05-loop5-file-clicked");
  log("CM at loop5:", await page.locator(".cm-editor, .cm-merge, .cm-mergeView").count());
  const body5 = page.locator(".window-diff-row-body");
  if (await body5.count() > 0) {
    writeFileSync(join(SHOT_DIR, "..", "v7-loop5-file-body.html"), await body5.first().innerHTML());
    log("loop5 file body chars:", (await body5.first().innerText()).length);
  }

  await browser.close();
  log("=== DONE ===");
}
main().catch(e => { log("[FATAL]", e?.message, e?.stack); process.exit(1); });
