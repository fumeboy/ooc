// Round 14 experience driver — Playwright + raw API
// Run: bun docs/round-14-experience/drive.ts
delete (process.env as any).http_proxy;
delete (process.env as any).HTTP_PROXY;
delete (process.env as any).https_proxy;
delete (process.env as any).HTTPS_PROXY;
process.env.NO_PROXY = "*";

import { chromium, type Page } from "playwright";
import { mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";

const SHOT_DIR = "/Users/zhangzhefu/x/ooc-2/ooc/docs/round-14-experience/screenshots";
const LOG = "/Users/zhangzhefu/x/ooc-2/ooc/docs/round-14-experience/run.log";
mkdirSync(SHOT_DIR, { recursive: true });
writeFileSync(LOG, `--- Round 14 drive @ ${new Date().toISOString()} ---\n`);

function log(...args: unknown[]) {
  const line = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
  console.log(line);
  appendFileSync(LOG, line + "\n");
}

async function shot(page: Page, name: string) {
  const p = join(SHOT_DIR, `${name}.png`);
  await page.screenshot({ path: p, fullPage: true });
  log("[shot]", name);
}

const BASE = "http://localhost:3000";
async function api(path: string, init?: RequestInit) {
  const r = await fetch(BASE + path, init);
  const text = await r.text();
  let body: any = text;
  try { body = JSON.parse(text); } catch {}
  if (!r.ok) log("[api err]", init?.method ?? "GET", path, r.status, text.slice(0, 300));
  return { status: r.status, body };
}

const TS = Date.now();
const SESSION_ID = `_test_experience_${TS}`;

async function main() {
  // === 0. Enable global debug ===
  log("=== 0. enable global debug");
  const ed = await api(`/api/runtime/debug/enable`, { method: "POST" });
  log("debug-enable", ed.status, JSON.stringify(ed.body).slice(0, 200));

  // === 1. Seed session (POST /api/sessions) ===
  log("=== 1. seed session", SESSION_ID);
  const c = await api(`/api/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sessionId: SESSION_ID,
      title: `R14 Experience ${TS}`,
      targetObjectId: "supervisor",
      initialMessage: "你好。请尝试调用一个 command（任意一个），但故意不填某个必填参数；让我观察 form 的 open 状态预检查行为。然后用 refine 补齐参数后 submit。",
    }),
  });
  log("seed-session", c.status, JSON.stringify(c.body).slice(0, 400));
  if (c.status >= 400) throw new Error("seed-session failed");

  // === Boot browser ===
  log("=== boot browser");
  const browser = await chromium.launch({
    args: ["--no-proxy-server"],
  });
  const context = await browser.newContext({ viewport: { width: 1500, height: 950 } });
  const page = await context.newPage();

  page.on("console", (msg) => {
    if (msg.type() === "error") log("[console.error]", msg.text().slice(0, 400));
  });
  page.on("pageerror", (e) => log("[pageerror]", e.message));
  page.on("requestfailed", (req) => log("[net failed]", req.url(), req.failure()?.errorText));

  // === 2. Visit user home ===
  log("=== 2. user home");
  await page.goto("http://localhost:5173/", { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  await shot(page, "01-user-home");

  // === 3. Threads list ===
  const threadsRes = await api(`/api/flows/${SESSION_ID}/threads`);
  const supervisorThread = threadsRes.body?.items?.find((t: any) => t.objectId === "supervisor");
  log("supervisor thread:", supervisorThread?.threadId);
  if (!supervisorThread) throw new Error("no supervisor thread");

  // === 4. Visit supervisor thread page ===
  const threadUrl = `http://localhost:5173/sessions/${SESSION_ID}/objects/supervisor/threads/${supervisorThread.threadId}`;
  log("=== 4. visit supervisor thread", threadUrl);
  await page.goto(threadUrl, { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
  await shot(page, "02-supervisor-thread-initial");

  // === 5. Poll thread until settles (the seed already enqueued a run) ===
  log("=== 5. poll until thread settles");
  let settled = false;
  let lastStatus = "";
  for (let i = 0; i < 90; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const ts = await api(`/api/flows/${SESSION_ID}/objects/supervisor/threads/${supervisorThread.threadId}`);
    const status = ts.body?.status;
    const cwCount = ts.body?.contextWindows?.length ?? 0;
    if (status !== lastStatus) log(`poll[${i}] status=${status} windows=${cwCount}`);
    lastStatus = status;
    if (status === "waiting" || status === "idle" || status === "done") {
      settled = true;
      log(`settled at iter=${i} status=${status}`);
      break;
    }
  }
  log("settled:", settled);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  await shot(page, "03-after-loop-settled");

  // === 6. Inspect contextWindows for forms ===
  const tFinal = await api(`/api/flows/${SESSION_ID}/objects/supervisor/threads/${supervisorThread.threadId}`);
  const cw: any[] = tFinal.body?.contextWindows ?? [];
  const forms = cw.filter((w) => w.type === "command_exec");
  log(`forms found: ${forms.length}`);
  for (const f of forms) {
    log("  form id=", f.id, "command=", f.commandPaths?.[0] ?? f.command, "status=", f.status);
  }
  writeFileSync(
    join(SHOT_DIR, "..", "thread-final-windows.json"),
    JSON.stringify({ status: tFinal.body?.status, windows: cw }, null, 2),
  );

  // === 7. Visit time machine view by clicking debug/loop nav ===
  log("=== 7. find time machine UI");
  const buttons = await page.locator("button, [role=tab], a").allInnerTexts();
  log("buttons sample:", buttons.slice(0, 50));

  for (const candidate of ["Loop Time Machine", "Time Machine", "时间机", "Loop Timeline", "loops", "Loop", "Debug"]) {
    const cnt = await page.getByText(candidate, { exact: false }).count();
    if (cnt > 0) log(`  found '${candidate}' x${cnt}`);
  }

  // Try clicking a likely tab
  for (const candidate of ["Loop Time Machine", "Time Machine", "Loop Timeline"]) {
    try {
      const el = page.getByText(candidate, { exact: false }).first();
      if (await el.count()) {
        await el.click({ timeout: 1500 });
        await page.waitForTimeout(1500);
        await shot(page, `04-time-machine-${candidate.replace(/\s+/g, "_")}`);
        break;
      }
    } catch (e: any) {
      log("[tm click err]", candidate, e?.message?.slice(0, 200));
    }
  }

  // === 8. Loop debug list (API direct) ===
  const ll = await api(
    `/api/runtime/flows/${SESSION_ID}/objects/supervisor/threads/${supervisorThread.threadId}/debug/loops`,
  );
  log("loop list count:", ll.body?.loops?.length, "sample:", JSON.stringify(ll.body?.loops?.slice(0, 5)));

  // If loops exist, fetch first/latest to inspect contextWindows shape
  if (ll.body?.loops?.length > 0) {
    const lastLoop = ll.body.loops[ll.body.loops.length - 1];
    const ld = await api(
      `/api/runtime/flows/${SESSION_ID}/objects/supervisor/threads/${supervisorThread.threadId}/debug/loops/${lastLoop.loopIndex}`,
    );
    writeFileSync(
      join(SHOT_DIR, "..", `loop-${lastLoop.loopIndex}.json`),
      JSON.stringify(ld.body, null, 2),
    );
    log("dumped loop", lastLoop.loopIndex);
  }

  // === 9. Try to find a form rendered in DOM and observe its color encoding ===
  log("=== 9. look at form DOM");
  const formTexts = await page.locator("text=/command_exec|form|open|executing|failed|success/i").allInnerTexts();
  log("form-related text sample:", formTexts.slice(0, 30));

  await shot(page, "05-final-state");

  await browser.close();
  log("=== DONE ===");
  log("session:", SESSION_ID);
  log("forms count:", forms.length);
  log("settled:", settled);
}

main().catch((e) => {
  log("[FATAL]", e?.message, e?.stack);
  process.exit(1);
});
