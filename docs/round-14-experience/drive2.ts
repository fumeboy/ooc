// Round 14 driver v2 — correct URLs + deeper inspection
delete (process.env as any).http_proxy;
delete (process.env as any).HTTP_PROXY;
delete (process.env as any).https_proxy;
delete (process.env as any).HTTPS_PROXY;
process.env.NO_PROXY = "*";

import { chromium, type Page } from "playwright";
import { mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";

const SHOT_DIR = "/Users/zhangzhefu/x/ooc-2/ooc/docs/round-14-experience/screenshots";
const LOG = "/Users/zhangzhefu/x/ooc-2/ooc/docs/round-14-experience/run2.log";
mkdirSync(SHOT_DIR, { recursive: true });
writeFileSync(LOG, `--- v2 @ ${new Date().toISOString()} ---\n`);

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

// Reuse the already-created session from v1 if still recent; otherwise create new.
const TS = Date.now();
const SESSION_ID = `_test_experience_${TS}`;

async function main() {
  await api(`/api/runtime/debug/enable`, { method: "POST" });

  log("=== 1. seed session");
  const c = await api(`/api/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sessionId: SESSION_ID,
      title: `R14 v2 ${TS}`,
      targetObjectId: "supervisor",
      initialMessage: "请尝试 open 一个 command（例如 write_file 或 talk），不要填全部参数。我想观察 form 在 status=open 时的预检查提示（knowledge 字段）。如果 submit 失败，请按 refine 流程修复。",
    }),
  });
  if (c.status >= 400) throw new Error("seed");

  const browser = await chromium.launch({ args: ["--no-proxy-server"] });
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
  const page = await ctx.newPage();

  page.on("console", (msg) => {
    if (msg.type() === "error") log("[console.error]", msg.text().slice(0, 400));
  });
  page.on("pageerror", (e) => log("[pageerror]", e.message));

  const threadsRes = await api(`/api/flows/${SESSION_ID}/threads`);
  const supervisor = threadsRes.body?.items?.find((t: any) => t.objectId === "supervisor");
  const TID = supervisor.threadId;
  log("supervisor TID:", TID);

  // === Visit user home ===
  await page.goto("http://localhost:5173/", { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  await shot(page, "v2-01-user-home");

  // === Visit session index ===
  const indexUrl = `http://localhost:5173/flows/index?sessionId=${SESSION_ID}`;
  log("=== visit session index", indexUrl);
  await page.goto(indexUrl, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  await shot(page, "v2-02-session-index");

  // === Visit thread_context BEFORE settle ===
  const ctxUrl = `http://localhost:5173/flows/thread_context?sessionId=${SESSION_ID}&objectId=supervisor&threadId=${TID}`;
  log("=== visit thread_context", ctxUrl);
  await page.goto(ctxUrl, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  await shot(page, "v2-03-thread-ctx-initial");

  // === Poll thread ===
  log("=== poll until settle");
  let settled = false;
  let lastStatus = "";
  for (let i = 0; i < 90; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const ts = await api(`/api/flows/${SESSION_ID}/objects/supervisor/threads/${TID}`);
    const status = ts.body?.status;
    if (status !== lastStatus) log(`poll[${i}] status=${status}`);
    lastStatus = status;
    if (status === "waiting" || status === "idle" || status === "done") { settled = true; break; }
  }
  log("settled:", settled);

  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  await shot(page, "v2-04-thread-ctx-settled");

  // === Buttons / tabs probe ===
  const btns = await page.locator("button, [role=tab], a").allInnerTexts();
  log("buttons/tabs:", btns.slice(0, 60));

  // === Try clicking Time Machine ===
  for (const label of ["Time Machine", "Loop", "Timeline", "Loop Time Machine", "Debug", "时间机"]) {
    const cnt = await page.getByText(label, { exact: false }).count();
    if (cnt > 0) log(`label '${label}' x${cnt}`);
  }

  // attempt click
  for (const label of ["Loop Time Machine", "Time Machine", "Loop Timeline"]) {
    const el = page.getByText(label, { exact: false }).first();
    if (await el.count()) {
      try {
        await el.click({ timeout: 1500 });
        await page.waitForTimeout(1500);
        await shot(page, `v2-05-time-machine-clicked-${label.replace(/\s+/g, "_")}`);
        break;
      } catch (e: any) {
        log("[click err]", label, e?.message?.slice(0, 200));
      }
    }
  }

  // === Inspect contextWindows JSON ===
  const tFinal = await api(`/api/flows/${SESSION_ID}/objects/supervisor/threads/${TID}`);
  const cw: any[] = tFinal.body?.contextWindows ?? [];
  const forms = cw.filter((w) => w.type === "command_exec");
  log(`forms final: ${forms.length}`);
  for (const f of forms) {
    log("  form id=", f.id, "command=", f.commandPaths?.[0] ?? f.command, "status=", f.status);
  }
  writeFileSync(join(SHOT_DIR, "..", "v2-thread-final.json"), JSON.stringify(tFinal.body, null, 2));

  // === Loop list ===
  const ll = await api(`/api/runtime/flows/${SESSION_ID}/objects/supervisor/threads/${TID}/debug/loops`);
  log("loops:", ll.body?.loops?.length);

  // Dump all loops
  if (ll.body?.loops?.length > 0) {
    for (const loop of ll.body.loops) {
      const ld = await api(`/api/runtime/flows/${SESSION_ID}/objects/supervisor/threads/${TID}/debug/loops/${loop.loopIndex}`);
      writeFileSync(
        join(SHOT_DIR, "..", `v2-loop-${loop.loopIndex}.json`),
        JSON.stringify(ld.body, null, 2),
      );
    }
    log("dumped all loops");
  }

  await shot(page, "v2-06-final");
  await browser.close();
  log("=== DONE ===");
  log("session:", SESSION_ID);
}

main().catch((e) => {
  log("[FATAL]", e?.message, e?.stack);
  process.exit(1);
});
