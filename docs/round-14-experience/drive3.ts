// Round 14 driver v3 — focus on time machine UI + diff view interaction
delete (process.env as any).http_proxy;
delete (process.env as any).HTTP_PROXY;
delete (process.env as any).https_proxy;
delete (process.env as any).HTTPS_PROXY;
process.env.NO_PROXY = "*";

import { chromium, type Page } from "playwright";
import { mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";

const SHOT_DIR = "/Users/zhangzhefu/x/ooc-2/ooc/docs/round-14-experience/screenshots";
const LOG = "/Users/zhangzhefu/x/ooc-2/ooc/docs/round-14-experience/run3.log";
mkdirSync(SHOT_DIR, { recursive: true });
writeFileSync(LOG, `--- v3 @ ${new Date().toISOString()} ---\n`);

function log(...a: unknown[]) {
  const s = a.map(x => typeof x === "string" ? x : JSON.stringify(x)).join(" ");
  console.log(s); appendFileSync(LOG, s + "\n");
}
async function shot(page: Page, name: string) {
  await page.screenshot({ path: join(SHOT_DIR, name + ".png"), fullPage: true });
  log("[shot]", name);
}
async function api(path: string, init?: RequestInit) {
  const r = await fetch("http://localhost:3000" + path, init);
  const text = await r.text();
  let body: any = text; try { body = JSON.parse(text); } catch {}
  if (!r.ok) log("[api err]", init?.method ?? "GET", path, r.status, text.slice(0, 300));
  return { status: r.status, body };
}

const SESSION_ID = process.env.SESSION || "_test_experience_1779878794073";

async function main() {
  const threadsRes = await api(`/api/flows/${SESSION_ID}/threads`);
  const supervisor = threadsRes.body?.items?.find((t: any) => t.objectId === "supervisor");
  const TID = supervisor.threadId;
  log("session:", SESSION_ID, "thread:", TID);

  const browser = await chromium.launch({ args: ["--no-proxy-server"] });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await ctx.newPage();

  page.on("console", (msg) => {
    if (msg.type() === "error") log("[console.error]", msg.text().slice(0, 300));
  });
  page.on("pageerror", (e) => log("[pageerror]", e.message));

  const url = `http://localhost:5173/flows/thread_context?sessionId=${SESSION_ID}&objectId=supervisor&threadId=${TID}`;
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);

  // Click Loop Timeline tab
  await page.getByText("Loop Timeline", { exact: false }).first().click();
  await page.waitForTimeout(1500);
  await shot(page, "v3-01-loop-timeline-default");

  // Probe DOM for the diff rows
  const diffRowTexts = await page.locator("[class*=loop-diff], [class*=window-diff], [class*=diff-row]").allInnerTexts();
  log("diff-row text:", diffRowTexts.slice(0, 30));

  // Try clicking various window diff rows
  // The screenshot showed: talk / custom / file / command_exec / command_exec
  for (const sel of ["text=/file/i >> nth=0", "text=/command_exec/i >> nth=0", "text=/talk/i >> nth=0", "text=/custom/i >> nth=0"]) {
    log("---try click", sel);
    try {
      const els = page.locator(sel);
      const cnt = await els.count();
      log("  count:", cnt);
    } catch (e: any) {
      log("  err:", e?.message?.slice(0, 200));
    }
  }

  // Look at row caret / expand affordance
  const buttons = await page.locator("button").allInnerTexts();
  log("buttons:", buttons.slice(0, 60));

  // Try to click each row by class
  const rows = page.locator("[class*=loop-window-diff-row], [class*=loop-diff-row]");
  const rowCount = await rows.count();
  log("row count:", rowCount);
  for (let i = 0; i < Math.min(rowCount, 6); i++) {
    try {
      await rows.nth(i).click({ timeout: 1500 });
      await page.waitForTimeout(800);
      await shot(page, `v3-02-row-clicked-${i}`);
    } catch (e: any) {
      log("[row click err]", i, e?.message?.slice(0, 200));
    }
  }

  // Try previous / next loop
  for (const label of ["Prev", "← Prev", "←", "Next", "Latest"]) {
    const el = page.getByText(label, { exact: false }).first();
    if (await el.count()) {
      try {
        await el.click({ timeout: 1500 });
        await page.waitForTimeout(800);
        log("clicked", label);
      } catch (e: any) {
        log("[label click]", label, e?.message?.slice(0, 200));
      }
    }
  }
  await shot(page, "v3-03-after-nav");

  // Navigate to a loop with file_window
  // First, find a loop that introduced w_file_mpnxw5c7_2l40
  // From loop dumps, loop 4 should have it appearing as added
  // Click Latest first to reset
  try {
    await page.getByText("Latest", { exact: false }).first().click({ timeout: 1500 });
    await page.waitForTimeout(1000);
  } catch {}

  // Navigate backwards to look at loop 4-5 transitions
  for (let i = 0; i < 6; i++) {
    try {
      await page.getByText("Prev", { exact: false }).first().click({ timeout: 1500 });
      await page.waitForTimeout(500);
    } catch {}
  }
  await shot(page, "v3-04-back-in-history");

  // Look for file window row
  const fileText = page.getByText(/^file\s/i).first();
  if (await fileText.count()) {
    log("found file row");
    try {
      await fileText.click({ timeout: 1500 });
      await page.waitForTimeout(1500);
      await shot(page, "v3-05-file-row-clicked");
    } catch (e: any) {
      log("[file click]", e?.message);
    }
  } else {
    log("no file row visible");
  }

  // Click 'changed' row if any
  const changed = page.getByText("changed", { exact: false });
  const cCount = await changed.count();
  log("changed labels:", cCount);

  // Final dump
  const html = await page.locator("body").innerHTML();
  writeFileSync(join(SHOT_DIR, "..", "v3-body-snapshot.html"), html.slice(0, 100_000));

  await shot(page, "v3-06-final");
  await browser.close();
  log("=== DONE ===");
}

main().catch((e) => {
  log("[FATAL]", e?.message, e?.stack);
  process.exit(1);
});
