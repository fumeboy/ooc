// v9 — focused screenshots of failed forms + context snapshot
delete (process.env as any).http_proxy;
delete (process.env as any).HTTP_PROXY;
delete (process.env as any).https_proxy;
delete (process.env as any).HTTPS_PROXY;
process.env.NO_PROXY = "*";
import { chromium, type Page } from "playwright";
import { mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";

const SHOT_DIR = "/Users/zhangzhefu/x/ooc-2/ooc/docs/round-14-experience/screenshots";
const LOG = "/Users/zhangzhefu/x/ooc-2/ooc/docs/round-14-experience/run9.log";
mkdirSync(SHOT_DIR, { recursive: true });
writeFileSync(LOG, `--- v9 @ ${new Date().toISOString()} ---\n`);
function log(...a: unknown[]) { const s = a.map(x => typeof x === "string" ? x : JSON.stringify(x)).join(" "); console.log(s); appendFileSync(LOG, s + "\n"); }
async function shot(p: Page, n: string) { await p.screenshot({ path: join(SHOT_DIR, n + ".png"), fullPage: true }); log("[shot]", n); }
async function api(p: string) { const r = await fetch("http://localhost:3000" + p); return await r.json(); }

const SESSION_ID = process.env.SESSION || "_test_experience_1779878794073";

async function main() {
  const t = await api(`/api/flows/${SESSION_ID}/threads`);
  const TID = t.items.find((x: any) => x.objectId === "supervisor").threadId;

  const browser = await chromium.launch({ args: ["--no-proxy-server"] });
  const ctx = await browser.newContext({ viewport: { width: 1800, height: 1100 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error") log("[err]", m.text().slice(0, 200)); });

  const url = `http://localhost:5173/flows/thread_context?sessionId=${SESSION_ID}&objectId=supervisor&threadId=${TID}`;
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  // Context Snapshot tab to see failed forms
  await page.getByText("Context Snapshot", { exact: false }).first().click().catch(() => {});
  await page.waitForTimeout(1500);
  await shot(page, "v9-01-context-snapshot");

  // expand tree
  // The TreeViewer probably has toggles. Click "form_exec" nodes or "command_exec" group
  // Try common expand affordances
  const toggles = page.locator("[aria-expanded=false]");
  log("aria-expanded=false count:", await toggles.count());
  // Click form-related nodes
  for (const label of ["command_exec", "form", "failed", "f_mpnxwkwf_jbnb", "f_mpnxx49e_8eui"]) {
    const els = page.getByText(label, { exact: false });
    log(`'${label}': ${await els.count()}`);
  }

  // Expand all chevrons
  const allToggles = page.locator(".tree-toggle, [class*='chevron']");
  log("chevrons:", await allToggles.count());
  // Just scroll & screenshot
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(500);
  await shot(page, "v9-02-context-scrolled");

  // Click on a command_exec node to see status pill
  const cmd = page.getByText("command_exec", { exact: false }).first();
  if (await cmd.count()) {
    try { await cmd.click({ timeout: 1500 }); await page.waitForTimeout(800); } catch {}
  }
  await shot(page, "v9-03-cmd-expanded");

  // Click failed badge / form
  const failedText = page.getByText("failed", { exact: false }).first();
  if (await failedText.count()) {
    try { await failedText.click({ timeout: 1500 }); await page.waitForTimeout(800); } catch {}
  }
  await shot(page, "v9-04-failed-clicked");

  // Visit user home with all sessions visible toggle
  await page.goto("http://localhost:5173/", { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
  // Click the eye toggle
  const eye = page.locator("button[aria-label*=显示], button[aria-label*=切换], button[title*=隐藏], button[title*=显示], button[title*=test]").first();
  if (await eye.count()) {
    try { await eye.click({ timeout: 1500 }); await page.waitForTimeout(800); log("clicked eye toggle"); } catch {}
  }
  await shot(page, "v9-05-user-home-eye-toggle");

  // Find toggles broadly
  const allBtnTitles = await page.locator("button").evaluateAll((els) =>
    els.map((el) => ({
      title: el.getAttribute("title"),
      ariaLabel: el.getAttribute("aria-label"),
      text: el.textContent?.slice(0, 30),
    })).filter(b => b.title || b.ariaLabel)
  );
  log("all button titles:", JSON.stringify(allBtnTitles));

  await browser.close();
  log("DONE");
}
main().catch(e => { log("[FATAL]", e?.message); process.exit(1); });
