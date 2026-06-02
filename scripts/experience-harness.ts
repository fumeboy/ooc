/**
 * AgentOfExperience harness — drive the live UI via Playwright, capture
 * findings (screenshots, console errors, network 4xx/5xx).
 *
 * Pre-req: app server on :3000, vite on :5173 already running (this script
 * does NOT spawn them — it's the体验官 entering an existing world).
 *
 * Usage: bun run scripts/experience-harness.ts [outDir]
 */

import { chromium, type ConsoleMessage, type Request, type Response } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUT_DIR = process.argv[2] ?? "/tmp/ooc-experience-001";
const BASE = "http://localhost:5173";

mkdirSync(OUT_DIR, { recursive: true });

interface Finding {
  step: string;
  ts: number;
  kind: "console" | "network" | "page-error" | "shot" | "note";
  payload: unknown;
}

const findings: Finding[] = [];
let stepName = "init";

function record(kind: Finding["kind"], payload: unknown) {
  findings.push({ step: stepName, ts: Date.now(), kind, payload });
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  page.on("console", (m: ConsoleMessage) => {
    const t = m.type();
    if (t === "error" || t === "warning") {
      record("console", { type: t, text: m.text(), url: m.location().url });
    }
  });
  page.on("pageerror", (err) => {
    record("page-error", { message: err.message, stack: err.stack });
  });
  page.on("requestfailed", (req: Request) => {
    record("network", { phase: "failed", method: req.method(), url: req.url(), failure: req.failure()?.errorText });
  });
  page.on("response", (res: Response) => {
    if (res.status() >= 400) {
      record("network", { phase: "response", status: res.status(), method: res.request().method(), url: res.url() });
    }
  });

  async function shoot(name: string) {
    const file = join(OUT_DIR, `${String(findings.length).padStart(3, "0")}_${name}.png`);
    await page.screenshot({ path: file, fullPage: true });
    record("shot", { file, name });
    return file;
  }

  // ── Step 1: 首屏 ────────────────────────────────────────────
  stepName = "01_landing";
  await page.goto(BASE, { waitUntil: "networkidle" });
  await shoot("landing");

  // ── Step 2: 找 sessions/flows 列表 ──────────────────────────
  stepName = "02_sessions_list";
  // 等可能的菜单/导航 hydrate
  await page.waitForTimeout(800);
  await shoot("after-hydrate");

  // 把 DOM 的 hierarchy 抓到，便于离线分析
  const domSnapshot = await page.evaluate(() => {
    function walk(el: Element, depth = 0): unknown {
      if (depth > 6) return "[truncated]";
      const tag = el.tagName.toLowerCase();
      const id = el.id ? `#${el.id}` : "";
      const cls = (el.className && typeof el.className === "string")
        ? `.${el.className.split(/\s+/).filter(Boolean).slice(0, 3).join(".")}`
        : "";
      const role = el.getAttribute("role");
      const text = (el.textContent ?? "").trim().slice(0, 60);
      return {
        tag: tag + id + cls + (role ? `[role=${role}]` : ""),
        text: text || undefined,
        children: Array.from(el.children).slice(0, 12).map((c) => walk(c, depth + 1)),
      };
    }
    return walk(document.body);
  });
  writeFileSync(join(OUT_DIR, "dom-snapshot.json"), JSON.stringify(domSnapshot, null, 2));
  record("note", { domSnapshotPath: join(OUT_DIR, "dom-snapshot.json") });

  // ── Step 3: 列出 API 看看后端能不能给数据 ────────────────────
  stepName = "03_api_probe";
  const sessionsRes = await page.evaluate(async () => {
    const r = await fetch("/api/sessions");
    return { status: r.status, body: await r.text() };
  });
  record("note", { api: "/api/sessions", ...sessionsRes });

  const flowsRes = await page.evaluate(async () => {
    const r = await fetch("/api/flows");
    return { status: r.status, body: await r.text() };
  });
  record("note", { api: "/api/flows", ...flowsRes });

  // ── Step 4: 试着创建 session 并发条 talk ──────────────────────
  stepName = "04_seed_session";
  const sid = `_test_experience_${Date.now()}`;
  const seedRes = await page.evaluate(async (sid) => {
    const r = await fetch("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId: sid,
        title: "Experience harness session",
        targetObjectId: "supervisor",
        initialMessage: "你好，请用一句话介绍 OOC 是什么。",
      }),
    });
    return { status: r.status, body: await r.text() };
  }, sid);
  record("note", { api: "/api/sessions POST seed", ...seedRes });

  // ── Step 5: 等 LLM 回完，刷新 UI ────────────────────────────
  stepName = "05_wait_for_llm";
  // 轮询 list-threads 看 supervisor.root 状态
  let lastSnapshot: unknown = null;
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const snap = await page.evaluate(async (sid) => {
      const r = await fetch(`/api/flows/${sid}/threads`);
      return r.ok ? await r.json() : null;
    }, sid);
    lastSnapshot = snap;
    if (snap && Array.isArray(snap.threads) && snap.threads.some((t: any) => t.status === "paused" || t.status === "done")) {
      break;
    }
    await page.waitForTimeout(2000);
  }
  record("note", { lastThreadSnapshot: lastSnapshot });

  // ── Step 6: 进入 session UI 看渲染 ──────────────────────────
  stepName = "06_session_view";
  await page.goto(`${BASE}/flows/${sid}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  await shoot("session-view");

  const sessionDom = await page.evaluate(() => {
    return {
      title: document.title,
      url: location.href,
      h1: document.querySelector("h1")?.textContent,
      headings: Array.from(document.querySelectorAll("h1, h2, h3"))
        .slice(0, 20)
        .map((h) => `${h.tagName}: ${h.textContent?.trim()}`),
      bodyTextLen: document.body.innerText.length,
      bodyPreview: document.body.innerText.slice(0, 500),
    };
  });
  record("note", { sessionDom });

  // ── Step 7: chat / talk_window 输入框？ ────────────────────
  stepName = "07_find_composer";
  const composerInfo = await page.evaluate(() => {
    const textareas = Array.from(document.querySelectorAll("textarea"));
    const inputs = Array.from(document.querySelectorAll("input[type=text], input:not([type])"));
    return {
      textareaCount: textareas.length,
      textareaPlaceholders: textareas.map((t) => t.placeholder),
      inputCount: inputs.length,
      inputPlaceholders: inputs.map((i) => (i as HTMLInputElement).placeholder),
      buttons: Array.from(document.querySelectorAll("button")).slice(0, 20).map((b) => b.textContent?.trim()).filter(Boolean),
    };
  });
  record("note", { composerInfo });

  await browser.close();

  // ── 汇总 ────────────────────────────────────────────────────
  const summary = {
    total: findings.length,
    byKind: findings.reduce<Record<string, number>>((acc, f) => {
      acc[f.kind] = (acc[f.kind] ?? 0) + 1;
      return acc;
    }, {}),
    consoleErrors: findings.filter((f) => f.kind === "console" && (f.payload as any).type === "error").length,
    pageErrors: findings.filter((f) => f.kind === "page-error").length,
    networkErrors: findings.filter((f) => f.kind === "network").length,
  };
  writeFileSync(join(OUT_DIR, "findings.json"), JSON.stringify(findings, null, 2));
  writeFileSync(join(OUT_DIR, "summary.json"), JSON.stringify(summary, null, 2));
  console.log("─── experience harness done ───");
  console.log(JSON.stringify(summary, null, 2));
  console.log(`Findings: ${OUT_DIR}/findings.json`);
}

main().catch((err) => {
  console.error("FATAL:", err);
  writeFileSync(join(OUT_DIR, "fatal.json"), JSON.stringify({ message: err.message, stack: err.stack }, null, 2));
  process.exit(1);
});
