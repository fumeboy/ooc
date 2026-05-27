// v8 — wait long and check final state of single click
delete (process.env as any).http_proxy;
delete (process.env as any).HTTP_PROXY;
delete (process.env as any).https_proxy;
delete (process.env as any).HTTPS_PROXY;
process.env.NO_PROXY = "*";
import { chromium, type Page } from "playwright";
import { mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";

const SHOT_DIR = "/Users/zhangzhefu/x/ooc-2/ooc/docs/round-14-experience/screenshots";
const LOG = "/Users/zhangzhefu/x/ooc-2/ooc/docs/round-14-experience/run8.log";
mkdirSync(SHOT_DIR, { recursive: true });
writeFileSync(LOG, `--- v8 @ ${new Date().toISOString()} ---\n`);
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
  page.on("console", (m) => log("[c]", m.type(), m.text().slice(0, 250)));
  page.on("response", (r) => { if (r.url().includes("loop")) log("[resp]", r.status(), r.url().slice(-80)); });

  const url = `http://localhost:5173/flows/thread_context?sessionId=${SESSION_ID}&objectId=supervisor&threadId=${TID}`;
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
  await page.getByText("Loop Timeline", { exact: false }).first().click();
  await page.waitForTimeout(1500);

  // Only click custom (changed) — wait 15 seconds
  const heads = page.locator(".window-diff-row-head");
  await heads.nth(1).click();
  log("clicked custom; waiting 15s");
  for (let i = 0; i < 15; i++) {
    await page.waitForTimeout(1000);
    const body = page.locator(".window-diff-row-body").first();
    const txt = await body.innerText().catch(() => "n/a");
    log(`t=${i+1}s body=${txt.length}c "${txt.slice(0, 80).replace(/\n/g, '|')}"`);
    if (txt.length > 25) break;
  }
  await shot(page, "v8-01-custom-15s-wait");
  const body = page.locator(".window-diff-row-body").first();
  writeFileSync(join(SHOT_DIR, "..", "v8-custom-15s.html"), await body.innerHTML());

  // Now try command_exec failed row
  await heads.nth(1).click(); // close
  await page.waitForTimeout(300);
  await heads.nth(3).click(); // command_exec
  log("clicked command_exec; waiting 15s");
  for (let i = 0; i < 15; i++) {
    await page.waitForTimeout(1000);
    const b = page.locator(".window-diff-row-body").first();
    const txt = await b.innerText().catch(() => "n/a");
    log(`t=${i+1}s body=${txt.length}c "${txt.slice(0, 80).replace(/\n/g, '|')}"`);
    if (txt.length > 25) break;
  }
  await shot(page, "v8-02-cmdexec-15s-wait");
  writeFileSync(join(SHOT_DIR, "..", "v8-cmdexec-15s.html"), await page.locator(".window-diff-row-body").first().innerHTML());

  await browser.close();
  log("DONE");
}
main().catch(e => { log("[FATAL]", e?.message); process.exit(1); });
