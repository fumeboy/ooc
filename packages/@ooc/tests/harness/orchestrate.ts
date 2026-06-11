#!/usr/bin/env bun
/**
 * 维度体验官 Harness 编排脚本。
 *
 * 为每个 OOC 维度起一条隔离流水线：mkdir world + 端口 → spawn 真实 OOC server →
 * spawn 一个 `claude -p --dangerously-skip-permissions` 体验官驱动它 → 收报告 → 清理。
 * 全维度并行（并发上限），最后聚合 dashboard。
 *
 * 用法：
 *   bun packages/@ooc/tests/harness/orchestrate.ts [flags]
 *   --dimensions a,b,c   只跑这些（默认全 8）
 *   --concurrency N      并发上限（默认 4）
 *   --timeout S          每个体验官超时秒（默认 1200）
 *   --smoke              只跑 1 个维度（默认 executable）真实端到端
 *   --dry-run            不起 claude，用 stub 体验官验编排闭环（无 LLM 成本）
 *   --keep-worlds        保留 /tmp world 供调试
 */
import { mkdir, rm } from "node:fs/promises";
import { join, dirname } from "node:path";

const ALL_DIMENSIONS = [
  "executable", "thinkable", "collaborable", "observable",
  "reflectable", "programmable", "visible", "persistable",
] as const;

const REPO_ROOT = process.cwd();
const HARNESS_DIR = join(REPO_ROOT, "packages/@ooc/tests/harness");
// 测试归属：体验官剧本（场景 + rubric）的单一来源已从 storybook specs/
// 进一步收编进 .ooc-world-meta 对象树——每个维度对象的 knowledge/tests.md 持有自己的 Tier A TC +
// Tier B rubric。orchestrate 读对应维度对象的 tests.md（storybook/specs/ 已删）。
const OBJECT_TREE_DIR = join(REPO_ROOT, ".ooc-world-meta/stones/main/objects/supervisor/children");
const SERVER_ENTRY = join(REPO_ROOT, "packages/@ooc/core/app/server/index.ts");
const PORT_BASE = 4100;
const NO_PROXY = "localhost,127.0.0.1";

function parseArgs() {
  const a = Bun.argv.slice(2);
  const get = (k: string) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : undefined; };
  const has = (k: string) => a.includes(k);
  const smoke = has("--smoke");
  const dims = get("--dimensions")?.split(",").map((s) => s.trim()).filter(Boolean)
    ?? (smoke ? ["executable"] : [...ALL_DIMENSIONS]);
  return {
    dimensions: dims,
    concurrency: Number(get("--concurrency") ?? (smoke ? 1 : 4)),
    timeoutMs: Number(get("--timeout") ?? 1200) * 1000,
    dryRun: has("--dry-run"),
    keepWorlds: has("--keep-worlds"),
    smoke,
  };
}

const env = { ...process.env, NO_PROXY, no_proxy: NO_PROXY };

async function ping(port: number): Promise<boolean> {
  const p = Bun.spawn({
    cmd: ["curl", "-s", "--noproxy", "*", "-o", "/dev/null", "-w", "%{http_code}",
          `http://localhost:${port}/api/health`],
    stdout: "pipe", stderr: "ignore", env,
  });
  const out = await new Response(p.stdout).text();
  await p.exited;
  return out.trim() === "200";
}

async function waitReady(port: number, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await ping(port)) return true;
    await Bun.sleep(1000);
  }
  return false;
}

/**
 * 超时诊断：抓 /api/runtime/activity 系统活动快照（server 此刻仍存活）。
 * 把「超时只标 TIMEOUT 盲黑盒」变成「超时即附带：哪些 job 跑了多久、被什么重复日志刷屏」。
 * best-effort——失败返回 null（诊断辅助，不应阻断 harness 收尾）。
 */
async function captureActivitySnapshot(port: number): Promise<any | null> {
  try {
    const p = Bun.spawn({
      cmd: ["curl", "-s", "--noproxy", "*", "--max-time", "5",
            `http://localhost:${port}/api/runtime/activity`],
      stdout: "pipe", stderr: "ignore", env,
    });
    const out = await new Response(p.stdout).text();
    await p.exited;
    return out.trim() ? JSON.parse(out) : null;
  } catch {
    return null; // 诊断快照抓取失败不阻断收尾（server 可能已先于 kill 退出）
  }
}

function buildOfficerPrompt(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{(\w+)\}/g, (m, k) => vars[k] ?? m);
}

type Result = {
  dimension: string; port: number; world: string;
  serverReady: boolean; officerExit: number | null; timedOut: boolean;
  reportExists: boolean; tier: string; durationMs: number; error?: string;
  /** 超时诊断备注（来自 activity 快照）：runningCount + 主导日志模式，展示在 dashboard 备注列。 */
  note?: string;
};

async function runDimension(
  dim: string, idx: number, runTs: string, runDir: string,
  promptTpl: string, opts: ReturnType<typeof parseArgs>,
): Promise<Result> {
  const port = PORT_BASE + idx;
  const world = `/tmp/ooc-harness-${dim}-${runTs}`;
  const reportPath = join(runDir, `${dim}.report.md`);
  const serverLog = join(runDir, `${dim}.server.log`);
  const officerLog = join(runDir, `${dim}.officer.log`);
  const t0 = Date.now();
  const res: Result = {
    dimension: dim, port, world, serverReady: false, officerExit: null,
    timedOut: false, reportExists: false, tier: "—", durationMs: 0,
  };

  await mkdir(world, { recursive: true });
  const serverLogFile = Bun.file(serverLog);
  const serverProc = Bun.spawn({
    cmd: ["bun", SERVER_ENTRY, "--world", world, "--port", String(port)],
    cwd: REPO_ROOT, env, stdout: serverLogFile, stderr: serverLogFile,
  });

  try {
    res.serverReady = await waitReady(port, 30_000);
    if (!res.serverReady) { res.error = "server not ready in 30s"; return res; }

    if (opts.dryRun) {
      // stub 体验官：验 spawn+捕获+报告收集闭环，无 LLM
      const stub = Bun.spawn({
        cmd: ["bash", "-c",
          `echo "[dry-run officer] ${dim} @ :${port} world=${world}"; ` +
          `mkdir -p "${dirname(reportPath)}"; ` +
          `printf -- '---\\ndimension: ${dim}\\nrun_ts: ${runTs}\\nbaseline_tier: DRYRUN\\nscenarios_run: 0\\nissues_count: 0\\n---\\n\\n# ${dim} (dry-run stub)\\n编排闭环验证：server ready=%s, port=${port}.\\n' "${res.serverReady}" > "${reportPath}"`],
        cwd: REPO_ROOT, env, stdout: "pipe", stderr: "pipe",
      });
      res.officerExit = await stub.exited;
    } else {
      const prompt = buildOfficerPrompt(promptTpl, {
        DIMENSION: dim, PORT: String(port), WORLD_DIR: world, RUN_TS: runTs,
        PLAYBOOK_PATH: join(OBJECT_TREE_DIR, dim, "knowledge/tests.md"),
        CHEATSHEET_PATH: join(HARNESS_DIR, "driver/cheatsheet.md"),
        SCHEMA_PATH: join(HARNESS_DIR, "report-schema.md"),
        REPORT_PATH: reportPath,
      });
      // stream-json + verbose：officer 每个 event 一行 jsonl 实时输出（不再到退出才 flush）。
      // 报告仍由 officer 自己写 reportPath，officer.log 仅供诊断，格式变化不影响报告收集。
      const officer = Bun.spawn({
        cmd: ["claude", "-p", prompt, "--dangerously-skip-permissions", "--add-dir", world,
              "--output-format", "stream-json", "--verbose"],
        cwd: REPO_ROOT, env, stdout: "pipe", stderr: "pipe",
      });
      // 增量落盘 stdout+stderr：timeout kill 也保留已产出，让超时维度不再黑盒
      // （旧逻辑只在退出后一次性 write，被 kill 丢失全部输出）。
      const sink = Bun.file(officerLog).writer();
      const pump = async (stream: ReadableStream<Uint8Array>) => {
        try { for await (const chunk of stream) { sink.write(chunk); await sink.flush(); } }
        catch { /* stream aborted on kill — 已 flush 的内容保留 */ }
      };
      const pumps = Promise.allSettled([pump(officer.stdout), pump(officer.stderr)]);
      let timer: Timer | undefined;
      const timeout = new Promise<"timeout">((r) => {
        timer = setTimeout(() => { try { officer.kill(); } catch {} r("timeout"); }, opts.timeoutMs);
      });
      const exit = officer.exited.then((c) => c as number | "timeout");
      const r = await Promise.race([exit, timeout]);
      if (timer) clearTimeout(timer);
      if (r === "timeout") {
        res.timedOut = true;
        // 超时即抓系统活动快照（server 仍存活，下方 finally 才 kill）——让 TIMEOUT 可诊断
        const snap = await captureActivitySnapshot(port);
        if (snap) {
          await Bun.write(join(runDir, `${dim}.timeout-snapshot.json`), JSON.stringify(snap, null, 2));
          const top = snap.logPatterns?.[0];
          res.note =
            `TIMEOUT 快照: running=${snap.runningCount}` +
            (top ? ` 主导日志=${top.key}×${top.count}` : " 无主导日志");
        } else {
          res.note = "TIMEOUT 快照抓取失败（server 可能已退）";
        }
      } else {
        res.officerExit = r;
      }
      await pumps;
      await sink.end();
    }
  } finally {
    try { serverProc.kill(); } catch {}
    await serverProc.exited.catch(() => {});
    if (!opts.keepWorlds) await rm(world, { recursive: true, force: true }).catch(() => {});
  }

  const rf = Bun.file(reportPath);
  res.reportExists = await rf.exists();
  if (res.reportExists) {
    const txt = await rf.text();
    res.tier = txt.match(/baseline_tier:\s*(\S+)/)?.[1] ?? "?";
  }
  res.durationMs = Date.now() - t0;
  return res;
}

async function pool<T, R>(items: T[], n: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) break;
      out[i] = await fn(items[i], i);
    }
  }));
  return out;
}

function writeDashboard(runDir: string, runTs: string, results: Result[], opts: ReturnType<typeof parseArgs>): string {
  const rows = results.map((r) =>
    `| ${r.dimension} | ${r.tier} | ${r.serverReady ? "✓" : "✗"} | ` +
    `${r.timedOut ? "TIMEOUT" : r.officerExit ?? "—"} | ${r.reportExists ? "✓" : "✗"} | ` +
    `${Math.round(r.durationMs / 1000)}s | ${r.note ?? r.error ?? ""} |`).join("\n");
  const md = `# 维度体验 Harness Dashboard

- run_ts: ${runTs}
- mode: ${opts.dryRun ? "dry-run" : opts.smoke ? "smoke" : "full"}
- 并发: ${opts.concurrency} / 超时: ${opts.timeoutMs / 1000}s/officer
- 维度: ${results.length}

## 维度 × 档位矩阵
| 维度 | baseline_tier | server | officer exit | report | 耗时 | 备注 |
|---|---|---|---|---|---|---|
${rows}

## 报告链接
${results.map((r) => `- [${r.dimension}](./${r.dimension}.report.md)${r.reportExists ? "" : " (缺)"}`).join("\n")}

> 横切问题（跨维度共性）需人工/后续聚合 agent 从各报告 Issue 提炼。
`;
  const p = join(runDir, "dashboard.md");
  Bun.write(p, md);
  return p;
}

async function main() {
  const opts = parseArgs();
  const runTs = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const runDir = join(REPO_ROOT, "docs/harness-reports", runTs);
  await mkdir(runDir, { recursive: true });
  const promptTpl = await Bun.file(join(HARNESS_DIR, "officer-prompt.md")).text();

  console.log(`[harness] mode=${opts.dryRun ? "dry-run" : opts.smoke ? "smoke" : "full"} ` +
    `dims=${opts.dimensions.join(",")} conc=${opts.concurrency} → ${runDir}`);

  const results = await pool(opts.dimensions, opts.concurrency, (dim, i) =>
    runDimension(dim, i, runTs, runDir, promptTpl, opts).catch((e): Result => ({
      dimension: dim, port: PORT_BASE + i, world: "", serverReady: false,
      officerExit: null, timedOut: false, reportExists: false, tier: "ERR",
      durationMs: 0, error: String(e),
    })));

  const dash = writeDashboard(runDir, runTs, results, opts);
  console.log(`\n[harness] done. dashboard: ${dash}`);
  for (const r of results) {
    console.log(`  ${r.dimension.padEnd(13)} tier=${r.tier.padEnd(7)} ` +
      `report=${r.reportExists ? "✓" : "✗"} ${r.timedOut ? "TIMEOUT" : ""} ${r.error ?? ""}`);
  }
  const allReported = results.every((r) => r.reportExists);
  process.exit(allReported ? 0 : 1);
}

main();
