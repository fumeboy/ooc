/**
 * Frontend e2e fixture — 共享给 `tests/e2e/frontend/*.spec.ts`。
 *
 * 详见 `docs/testing/strategy.md` 与 `docs/testing/oocable-codeagent-frontend-e2e.md`。
 *
 * 启动模型（spec § 启动模型）：
 * 1. spawn 后端：bun src/app/server/index.ts --world <mkdtemp>，端口 OOC_APP_PORT=<random>
 * 2. spawn Vite dev：bun --cwd web run dev --port <random>，注 OOC_API_TARGET 指向后端
 * 3. test.extend 把 baseURL / baseDir 注入到每个 spec
 * 4. 测试结束 kill 两个进程 + rm baseDir
 *
 * 真 LLM 三件套或 RUN_FRONTEND_E2E 缺一 → fixture 在 beforeAll 抛 skip。
 */

import { test as base, expect, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";

// ────────────────────────────────────────────────────────────────────────────
// .env / gate
// ────────────────────────────────────────────────────────────────────────────

export function loadRealEnv(): void {
  const candidates = [resolve(process.cwd(), ".env"), resolve(process.cwd(), "../../.env")];
  for (const envPath of candidates) {
    if (!existsSync(envPath)) continue;
    for (const line of readFileSync(envPath, "utf-8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const sep = trimmed.indexOf("=");
      if (sep <= 0) continue;
      const key = trimmed.slice(0, sep);
      if (process.env[key] === undefined) process.env[key] = trimmed.slice(sep + 1);
    }
    return;
  }
}

export const shouldRunFrontendE2E = process.env.RUN_FRONTEND_E2E === "1";

export function hasLlmEnv(): boolean {
  return Boolean(process.env.OOC_API_KEY && process.env.OOC_BASE_URL && process.env.OOC_MODEL);
}

// ────────────────────────────────────────────────────────────────────────────
// 进程 spawn helpers
// ────────────────────────────────────────────────────────────────────────────

function pickPort(): number {
  // 30000-60000 之间随机；fixture 自己判 readiness，不依赖此随机。
  return 30_000 + Math.floor(Math.random() * 30_000);
}

async function waitForHttp(url: string, timeoutMs = 30_000, intervalMs = 250): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { method: "GET" });
      if (res.ok) return;
      lastErr = new Error(`HTTP ${res.status}`);
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`waitForHttp timed out for ${url}: ${String(lastErr)}`);
}

type SpawnedProcess = {
  proc: ChildProcess;
  kill: () => Promise<void>;
};

function killGracefully(proc: ChildProcess): Promise<void> {
  return new Promise((resolveKill) => {
    if (proc.exitCode !== null || proc.signalCode !== null) {
      resolveKill();
      return;
    }
    const onExit = () => resolveKill();
    proc.once("exit", onExit);
    proc.kill("SIGTERM");
    setTimeout(() => {
      if (proc.exitCode === null) proc.kill("SIGKILL");
    }, 3_000);
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Backend / Vite 启动
// ────────────────────────────────────────────────────────────────────────────

export type SeedFile = { path: string; content: string };
export type SeedStone = { objectId: string; self?: string; readme?: string };

function seedBaseDir(baseDir: string, opts: { seedFiles?: SeedFile[]; seedStones?: SeedStone[] }) {
  for (const file of opts.seedFiles ?? []) {
    const abs = join(baseDir, file.path);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, file.content, "utf8");
  }
  for (const stone of opts.seedStones ?? []) {
    const stoneDir = join(baseDir, "stones", stone.objectId);
    mkdirSync(join(stoneDir, "knowledge"), { recursive: true });
    writeFileSync(
      join(stoneDir, ".stone.json"),
      JSON.stringify({ objectId: stone.objectId, name: stone.objectId, createdAt: Date.now() }, null, 2),
      "utf8",
    );
    if (stone.self !== undefined) writeFileSync(join(stoneDir, "self.md"), stone.self, "utf8");
    if (stone.readme !== undefined) writeFileSync(join(stoneDir, "readme.md"), stone.readme, "utf8");
  }
}

export type BackendHandle = SpawnedProcess & {
  port: number;
  baseDir: string;
  baseURL: string;
};

export async function startBackend(opts: {
  seedFiles?: SeedFile[];
  seedStones?: SeedStone[];
} = {}): Promise<BackendHandle> {
  const baseDir = mkdtempSync(join(tmpdir(), "ooc-e2e-fe-"));
  seedBaseDir(baseDir, opts);

  const port = pickPort();
  const repoRoot = resolve(process.cwd());
  const proc = spawn(
    "bun",
    [join(repoRoot, "src/app/server/index.ts"), "--world", baseDir],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        OOC_APP_PORT: String(port),
        // 默认 worker tick 数偏低；前端 e2e 任务可能更长。
        OOC_WORKER_MAX_TICKS: "30",
        OOC_WORKER_POLL_MS: "50",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  // 把 backend 输出附到 stderr，便于排查（spec 失败时翻 trace）。
  proc.stdout?.on("data", (chunk) => process.stderr.write(`[backend stdout] ${chunk}`));
  proc.stderr?.on("data", (chunk) => process.stderr.write(`[backend stderr] ${chunk}`));

  const baseURL = `http://127.0.0.1:${port}`;
  try {
    await waitForHttp(`${baseURL}/api/health`, 30_000);
  } catch (err) {
    await killGracefully(proc);
    rmSync(baseDir, { recursive: true, force: true });
    throw err;
  }

  return {
    proc,
    port,
    baseDir,
    baseURL,
    kill: async () => {
      await killGracefully(proc);
      try {
        rmSync(baseDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    },
  };
}

export type WebHandle = SpawnedProcess & {
  port: number;
  url: string;
};

export async function startWeb(backendURL: string): Promise<WebHandle> {
  const port = pickPort();
  const repoRoot = resolve(process.cwd());
  const proc = spawn(
    "bun",
    ["--cwd", "web", "run", "dev", "--", "--port", String(port), "--strictPort"],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        OOC_API_TARGET: backendURL,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  proc.stdout?.on("data", (chunk) => process.stderr.write(`[web stdout] ${chunk}`));
  proc.stderr?.on("data", (chunk) => process.stderr.write(`[web stderr] ${chunk}`));

  const url = `http://127.0.0.1:${port}`;
  try {
    await waitForHttp(url, 30_000);
  } catch (err) {
    await killGracefully(proc);
    throw err;
  }

  return {
    proc,
    port,
    url,
    kill: () => killGracefully(proc),
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Playwright test.extend：把 baseDir/baseURL/webURL 注入每个 spec
// ────────────────────────────────────────────────────────────────────────────

export type OocFixture = {
  backend: BackendHandle;
  web: WebHandle;
  seedScenario: (opts: { seedFiles?: SeedFile[]; seedStones?: SeedStone[] }) => Promise<void>;
};

/**
 * test 扩展：使用方式
 *
 *   test("F1", async ({ page, ooc }) => {
 *     await ooc.seedScenario({ seedStones: [{ objectId: "assistant" }] });
 *     await page.goto(ooc.web.url);
 *     ...
 *   });
 *
 * 每个 test 用独立的 backend + web 进程（worker 串行；隔离更可靠）。
 */
export const test = base.extend<{ ooc: OocFixture }>({
  ooc: async ({}, use) => {
    if (!shouldRunFrontendE2E) {
      test.skip(true, "RUN_FRONTEND_E2E=1 未设置，跳过 frontend e2e");
      return;
    }
    loadRealEnv();
    if (!hasLlmEnv()) {
      test.skip(true, "OOC_API_KEY / OOC_BASE_URL / OOC_MODEL 缺失，跳过 frontend e2e");
      return;
    }

    let backend: BackendHandle | undefined;
    let web: WebHandle | undefined;
    let seeded = false;

    const fixture: OocFixture = {
      // 这两个 getter 在 seedScenario 前会抛；强制 spec 先 seed
      get backend() {
        if (!backend) throw new Error("call await ooc.seedScenario({...}) before reading ooc.backend");
        return backend;
      },
      get web() {
        if (!web) throw new Error("call await ooc.seedScenario({...}) before reading ooc.web");
        return web;
      },
      async seedScenario(opts) {
        if (seeded) throw new Error("seedScenario 每个 test 只能调一次");
        seeded = true;
        backend = await startBackend(opts);
        web = await startWeb(backend.baseURL);
      },
    };

    await use(fixture);

    if (web) await web.kill();
    if (backend) await backend.kill();
  },
});

export { expect };

// ────────────────────────────────────────────────────────────────────────────
// UI 操作 helpers
// ────────────────────────────────────────────────────────────────────────────

/**
 * 通过 SessionCreator 表单提交并等待跳转到 chat 页。
 *
 * SessionCreator 字段（见 web/src/domains/sessions/components/SessionCreator.tsx）：
 *   #session-id            input
 *   #target-object-id      select
 *   #initial-message       textarea
 *   button:has-text("Create session")
 */
export async function createSessionVia(
  page: Page,
  input: { sessionId?: string; targetObjectId: string; firstMessage: string },
): Promise<void> {
  if (input.sessionId) {
    await page.locator("#session-id").fill(input.sessionId);
  }
  await page.locator("#target-object-id").selectOption(input.targetObjectId);
  await page.locator("#initial-message").fill(input.firstMessage);
  await page.getByRole("button", { name: /create session/i }).click();
  // RightPanel 出现意味着已经进入 chat 页（thread.creator=user 时显示 composer）
  await page.locator(".right-panel").waitFor({ state: "visible", timeout: 30_000 });
}

/** 等 ChatPanel 的 .chat-timeline 出现一条非空 assistant 消息（超过 since 之前的数量）。 */
export async function waitForReply(
  page: Page,
  opts: { sinceCount: number; timeoutMs?: number } = { sinceCount: 0 },
): Promise<number> {
  const timeoutMs = opts.timeoutMs ?? 90_000;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    // ThreadTimeline 渲染的消息节点用 .timeline-message 或 .chat-message；多套兼容
    const count = await page
      .locator(".chat-timeline .timeline-message, .chat-timeline .message, .chat-timeline [data-role='assistant']")
      .count();
    if (count > opts.sinceCount) return count;
    await page.waitForTimeout(500);
  }
  throw new Error(`waitForReply: 等 assistant 新回复超时（since=${opts.sinceCount}）`);
}

/** 在 right-panel composer 输入并 send；等回复条数增长。 */
export async function sendFollowup(page: Page, text: string): Promise<number> {
  const before = await page.locator(".chat-timeline .timeline-message, .chat-timeline .message").count();
  await page.locator(".chat-composer-input").fill(text);
  await page.getByRole("button", { name: /send message/i }).click();
  return await waitForReply(page, { sinceCount: before });
}

// ────────────────────────────────────────────────────────────────────────────
// FS / thread.json 观察 helpers（前端断言"机制状态"用）
// ────────────────────────────────────────────────────────────────────────────

export function readFsState(baseDir: string, relPath: string): string {
  return readFileSync(join(baseDir, relPath), "utf8");
}

export function readThreadJson(
  baseDir: string,
  sessionId: string,
  objectId: string,
  threadId: string,
): unknown {
  const p = join(baseDir, "flows", sessionId, "objects", objectId, "threads", threadId, "thread.json");
  return JSON.parse(readFileSync(p, "utf8"));
}

/** seedSession 后 callee 的 threadId 由 talk-delivery 生成；通过扫目录定位。 */
export async function discoverCalleeThreadId(
  baseDir: string,
  sessionId: string,
  objectId: string,
  opts: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<string> {
  const { readdir } = await import("node:fs/promises");
  const threadsDir = join(baseDir, "flows", sessionId, "objects", objectId, "threads");
  const deadline = Date.now() + (opts.timeoutMs ?? 30_000);
  while (Date.now() < deadline) {
    try {
      const entries = await readdir(threadsDir, { withFileTypes: true });
      const ids = entries.filter((e) => e.isDirectory()).map((e) => e.name);
      // talk-delivery 生成的 callee thread 不叫 "root"（root 留给 creator 自身的初始 thread）
      const callee = ids.find((id) => id !== "root") ?? ids[0];
      if (callee) return callee;
    } catch {
      /* 目录还没出现，继续等 */
    }
    await new Promise((r) => setTimeout(r, opts.intervalMs ?? 200));
  }
  throw new Error(`discoverCalleeThreadId: 等 ${threadsDir} 出现 thread 超时`);
}

export function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let n = 0;
  let from = 0;
  while (true) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) return n;
    n += 1;
    from = at + needle.length;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Score 裁判 — 与 backend fixture 同形态
// ────────────────────────────────────────────────────────────────────────────

export type ScoreRule = { name: string; check: () => boolean };
export type ScoredTier = "Good" | "OK" | "Bad";
export type ScoreResult = {
  tier: ScoredTier;
  hits: { bad: string[]; goodPassed: string[]; goodFailed: string[] };
  scenario?: string;
};

export function scoreScenario(input: {
  scenario?: string;
  bad: ScoreRule[];
  good: ScoreRule[];
}): ScoreResult {
  const badHits = input.bad.filter((r) => r.check()).map((r) => r.name);
  const goodPassed: string[] = [];
  const goodFailed: string[] = [];
  for (const rule of input.good) {
    if (rule.check()) goodPassed.push(rule.name);
    else goodFailed.push(rule.name);
  }
  const tier: ScoredTier =
    badHits.length > 0 ? "Bad" : goodFailed.length === 0 ? "Good" : "OK";
  return { tier, hits: { bad: badHits, goodPassed, goodFailed }, scenario: input.scenario };
}

export function logScore(result: ScoreResult, observations?: Record<string, unknown>): void {
  const payload = observations ? { ...result, observations } : result;
  // eslint-disable-next-line no-console
  console.log(`[e2e-score] ${JSON.stringify(payload)}`);
}

/** 抓取浏览器 console.error 列表；spec 用作 Good/Bad 的依据。 */
export function collectConsoleErrors(page: Page): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
    else if (msg.type() === "warning") warnings.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(err.message));
  return { errors, warnings };
}
