/**
 * Backend e2e fixture — 共享给所有 `tests/e2e/backend/*.e2e.test.ts` 的工具集。
 *
 * 设计要点：
 * - 通过 `app.handle(new Request(...))` 直调 in-process Elysia，不起真端口（与
 *   `src/app/server/__tests__/real-app-server.test.ts` 同形态，但走新 seedSession 路径）
 * - 每个测试 mkdtemp 一份独立 baseDir + 独立 worker；测试结束自动清理
 * - Score 裁判把"Good/OK/Bad"三档落地为可读结构，由调用方传入 bad/good 规则集
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { nestedObjectPath } from "@ooc/core/persistable";
import type { ThreadContext, ProcessEvent, ThreadMessage } from "@ooc/core/_shared/types/thread.js";
import type { ContextWindow } from "@ooc/core/_shared/types/context-window.js";

// 重型依赖（Elysia / openai / executable 全家桶）走 lazy import — 测试 skip 时不触发，
// 避免因 node_modules 未完整安装而连"能不能加载该 spec"都失败。
type BuildServer = typeof import("@ooc/core/app/server")["buildServer"];
type ReadThread = typeof import("@ooc/builtins/agent/thread/persistable/thread-json")["readThread"];
type CreatePauseStore = typeof import("@ooc/core/app/server/runtime/pause-store")["createPauseStore"];
type CreateJobManager = typeof import("@ooc/core/app/server/runtime/job-manager")["createJobManager"];
type StartJobWorker = typeof import("@ooc/core/app/server/runtime/worker")["startJobWorker"];

let _deps:
  | {
      buildServer: BuildServer;
      readThread: ReadThread;
      createPauseStore: CreatePauseStore;
      createJobManager: CreateJobManager;
      startJobWorker: StartJobWorker;
    }
  | undefined;

async function loadDeps() {
  if (_deps) return _deps;
  const [
    { buildServer },
    { readThread },
    { createPauseStore },
    { createJobManager },
    { startJobWorker },
  ] = await Promise.all([
    import("@ooc/core/app/server"),
    import("@ooc/builtins/agent/thread/persistable/thread-json"),
    import("@ooc/core/app/server/runtime/pause-store"),
    import("@ooc/core/app/server/runtime/job-manager"),
    import("@ooc/core/app/server/runtime/worker"),
  ]);
  _deps = { buildServer, readThread, createPauseStore, createJobManager, startJobWorker };
  return _deps;
}

// ────────────────────────────────────────────────────────────────────────────
// 真 LLM 环境与 gate
// ────────────────────────────────────────────────────────────────────────────

/** 从仓库根的 `.env` 加载 `OOC_*` 到 `process.env`；与 real-app-server.test.ts 同行为。 */
export function loadRealEnv(): void {
  const candidates = [
    resolve(process.cwd(), ".env"),
    resolve(process.cwd(), "../../.env"),
  ];
  for (const envPath of candidates) {
    if (!existsSync(envPath)) continue;
    for (const line of readFileSync(envPath, "utf-8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const sep = trimmed.indexOf("=");
      if (sep <= 0) continue;
      const key = trimmed.slice(0, sep);
      if (process.env[key] === undefined) {
        process.env[key] = trimmed.slice(sep + 1);
      }
    }
    return;
  }
}

/** 主线 e2e gate：默认 skip；CI 与本地用 `RUN_BACKEND_E2E=1 bun test` 显式开启。 */
export const shouldRunBackendE2E = process.env.RUN_BACKEND_E2E === "1";

/** 真 LLM 三件套是否齐备；缺一即跳过。 */
export function hasLlmEnv(): boolean {
  return Boolean(process.env.OOC_API_KEY && process.env.OOC_BASE_URL && process.env.OOC_MODEL);
}

// ────────────────────────────────────────────────────────────────────────────
// App 与 baseDir 生命周期
// ────────────────────────────────────────────────────────────────────────────

export type AppHandle = {
  app: ReturnType<BuildServer>;
  baseDir: string;
  cleanup: () => void;
};

export type SeedFile = { path: string; content: string };

/** 在 baseDir 下创建一个最小可用的 stone（带 self.md）。target 是 seedSession 的对话对象。 */
export type SeedStone = {
  objectId: string;
  self?: string;
  readable?: string;
};

/**
 * 启动一份隔离的 OOC app：
 * - mkdtemp baseDir
 * - 可选写入 seed 源码文件（path 相对 baseDir）
 * - 可选写入 seed stone（落到 baseDir/stones/{id}）
 * - workerEnabled=true、workerPollMs=50 让 worker 真跑
 *
 * 返回 cleanup 必须在 afterEach 中调用，否则会泄漏 baseDir 与 worker 计时器。
 */
export async function startApp(opts: {
  seedFiles?: SeedFile[];
  seedStones?: SeedStone[];
  workerMaxTicks?: number;
  /**
   * 初始化 stones/main 为 git repo 并做一次 bootstrap commit。
   *
   * 涉及 stone-versioning 的场景（如 super flow 改 self.md 应进 git）必须置 true，
   * 否则 seed 的 stones/main/objects/<id>/self.md 没有 git 仓库可 commit。
   */
  initStoneGit?: boolean;
} = {}): Promise<AppHandle> {
  const { buildServer, createPauseStore, createJobManager, startJobWorker } =
    await loadDeps();
  const baseDir = mkdtempSync(join(tmpdir(), "ooc-e2e-be-"));

  for (const file of opts.seedFiles ?? []) {
    const absPath = join(baseDir, file.path);
    mkdirSync(dirname(absPath), { recursive: true });
    writeFileSync(absPath, file.content, "utf8");
  }

  for (const stone of opts.seedStones ?? []) {
    const stoneDir = join(baseDir, "stones", "main", "objects", stone.objectId);
    mkdirSync(stoneDir, { recursive: true });
    mkdirSync(join(stoneDir, "knowledge"), { recursive: true });
    writeFileSync(
      join(stoneDir, ".stone.json"),
      JSON.stringify({ objectId: stone.objectId, name: stone.objectId, createdAt: Date.now() }, null, 2),
      "utf8",
    );
    if (stone.self !== undefined) {
      writeFileSync(join(stoneDir, "self.md"), stone.self, "utf8");
    }
    if (stone.readable !== undefined) {
      writeFileSync(join(stoneDir, "readable.md"), stone.readable, "utf8");
    }
  }

  if (opts.initStoneGit) {
    // 初始化 stones/main 为 git repo，让后续 stone 写（session worktree / 控制面直写）有 repo 可 commit。
    const mainDir = join(baseDir, "stones", "main");
    mkdirSync(mainDir, { recursive: true });
    Bun.spawnSync(["git", "init", "-b", "main"], { cwd: mainDir, stdout: "pipe", stderr: "pipe" });
    Bun.spawnSync(["git", "add", "-A"], { cwd: mainDir, stdout: "pipe", stderr: "pipe" });
    Bun.spawnSync(
      [
        "git",
        "-c",
        "user.name=bootstrap",
        "-c",
        "user.email=bootstrap@ooc.local",
        "commit",
        "-m",
        "chore(bootstrap): import existing stones/",
        "--allow-empty",
      ],
      { cwd: mainDir, stdout: "pipe", stderr: "pipe" },
    );
  }

  // 关键：每个测试用独立的 pauseStore/jobManager，避免 module-level 默认 store 串扰多场景。
  const pauseStore = createPauseStore();
  const jobManager = createJobManager();
  const config = {
    port: 0,
    baseDir,
    workerPollMs: 50,
    // workerEnabled=false 让 buildServer 不自动起 worker；我们手动起 / 关，
    // 否则 buildServer 把 worker.stop 挂在 app.onStop 上，而我们不调 .listen()/.stop()，
    // worker 计时器会泄漏到下一个测试。
    workerEnabled: false,
    workerMaxTicks: opts.workerMaxTicks ?? 30,
    pauseStore,
    jobManager,
  };
  const app: ReturnType<BuildServer> = buildServer(config);
  const worker = startJobWorker(config);

  return {
    app,
    baseDir,
    cleanup: () => {
      try {
        worker.stop();
      } catch {
        /* ignore */
      }
      try {
        rmSync(baseDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    },
  };
}

// ────────────────────────────────────────────────────────────────────────────
// HTTP helpers
// ────────────────────────────────────────────────────────────────────────────

async function readJson(response: Response): Promise<any> {
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return { __raw: text };
  }
}

export async function postJson(app: AppHandle["app"], path: string, body: unknown) {
  const response = await app.handle(
    new Request(`http://localhost${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  const json = await readJson(response);
  return { status: response.status, body: json };
}

export async function getJson(app: AppHandle["app"], path: string) {
  const response = await app.handle(new Request(`http://localhost${path}`));
  const json = await readJson(response);
  return { status: response.status, body: json };
}

/** Seed 一个新 session：建 user + 指向 target 的 talk_window + 投递首条消息。 */
export type SeedSessionInput = {
  sessionId: string;
  targetObjectId: string;
  initialMessage: string;
  title?: string;
};

export type SeedSessionResult = {
  sessionId: string;
  userThreadId: string;
  talkWindowId: string;
  targetObjectId: string;
  targetThreadId: string;
  jobId: string;
};

export async function seedSession(
  app: AppHandle["app"],
  input: SeedSessionInput,
): Promise<SeedSessionResult> {
  const { status, body } = await postJson(app, "/api/sessions", input);
  if (status !== 200) {
    throw new Error(`seedSession failed: HTTP ${status} ${JSON.stringify(body)}`);
  }
  return body as SeedSessionResult;
}

/** 等 job 跑到 done/failed，或超时返回最后一次状态。 */
export async function waitForJob(
  app: AppHandle["app"],
  jobId: string,
  opts: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<{ status: string; error?: string; jobId: string }> {
  const timeoutMs = opts.timeoutMs ?? 180_000;
  const intervalMs = opts.intervalMs ?? 500;
  const deadline = Date.now() + timeoutMs;
  let last: any = { status: "unknown" };
  while (Date.now() < deadline) {
    const { body } = await getJson(app, `/api/runtime/jobs/${jobId}`);
    last = body ?? last;
    if (last?.status === "done" || last?.status === "failed") return last;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return last;
}

/**
 * 走 user.root.talk_window 投递第二轮消息；返回新 job + 等其跑完后的状态。
 *
 * 与 seedSession 配对使用——seedSession 已建好 user 与 talk_window，
 * 这里只是模拟"用户在 UI 里又发一条"。
 */
export async function continueThread(
  app: AppHandle["app"],
  sessionId: string,
  text: string,
  targetWindowId?: string,
): Promise<{ jobId: string }> {
  const { status, body } = await postJson(app, `/api/flows/${sessionId}/continue`, {
    text,
    ...(targetWindowId ? { targetWindowId } : {}),
  });
  if (status !== 200) {
    throw new Error(`continueThread failed: HTTP ${status} ${JSON.stringify(body)}`);
  }
  return body as { jobId: string };
}

// ────────────────────────────────────────────────────────────────────────────
// Thread / 文件观察 helpers
// ────────────────────────────────────────────────────────────────────────────

export async function readCalleeThread(
  baseDir: string,
  sessionId: string,
  objectId: string,
  threadId: string,
): Promise<ThreadContext | undefined> {
  const { readThread } = await loadDeps();
  return await readThread({ baseDir, sessionId, objectId }, threadId);
}

export async function readUserRootThread(
  baseDir: string,
  sessionId: string,
): Promise<ThreadContext | undefined> {
  const { readThread } = await loadDeps();
  return await readThread({ baseDir, sessionId, objectId: "user" }, "root");
}

export function readFile(baseDir: string, relPath: string): string {
  return readFileSync(join(baseDir, relPath), "utf8");
}

export function countOccurrences(text: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let from = 0;
  while (true) {
    const at = text.indexOf(needle, from);
    if (at === -1) return count;
    count += 1;
    from = at + needle.length;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Events / commands 观察
// ────────────────────────────────────────────────────────────────────────────

type FnCallEvent = Extract<ProcessEvent, { kind: "function_call" }>;

function isFnCall(event: ProcessEvent): event is FnCallEvent {
  return event.category === "llm_interaction" && event.kind === "function_call";
}

/** 抽取本 thread 中 LLM 调用过的 methodPath 列表（开过的 method_exec window 方法名）。 */
export function listOpenedCommands(thread: ThreadContext | undefined): string[] {
  if (!thread) return [];
  const seen: string[] = [];
  for (const e of thread.events) {
    if (!isFnCall(e) || e.toolName !== "exec") continue;
    const cmd = (e.arguments as { method?: unknown } | undefined)?.method;
    if (typeof cmd === "string") seen.push(cmd);
  }
  return seen;
}

/** 判断 thread 是否用 `program(language="shell")` 修改过文件。 */
export function usedShellProgram(thread: ThreadContext | undefined): boolean {
  if (!thread) return false;
  for (const e of thread.events) {
    if (!isFnCall(e) || e.toolName !== "exec") continue;
    const args = (e.arguments ?? {}) as Record<string, unknown>;
    if (args.method !== "root.program") continue;
    const nested = (args.args as Record<string, unknown> | undefined) ?? {};
    const lang = nested.language ?? nested.lang ?? args.language ?? args.lang;
    if (lang === "shell") return true;
  }
  return false;
}

/** function_call.toolName 出现的总次数（用于 OK 档"重试 ≥ N 次"判断）。 */
export function countMethodOpens(thread: ThreadContext | undefined, methodName: string): number {
  if (!thread) return 0;
  let n = 0;
  for (const e of thread.events) {
    if (!isFnCall(e) || e.toolName !== "exec") continue;
    if ((e.arguments as { method?: unknown } | undefined)?.method === methodName) n += 1;
  }
  return n;
}

/** 提取 outbox 中 assistant→user 的回复列表（按时间序）。 */
export function assistantRepliesToUser(thread: ThreadContext | undefined): ThreadMessage[] {
  if (!thread?.outbox) return [];
  return thread.outbox
    .filter((m) => m.toThreadId === "root" || m.toThreadId === "user" || m.source === "talk")
    .slice()
    .sort((a, b) => a.createdAt - b.createdAt);
}

/** user.root.outbox 中 user→callee 的消息条数（应等于"用户发过多少句"）。 */
export function userOutboxMessages(userThread: ThreadContext | undefined): ThreadMessage[] {
  if (!userThread?.outbox) return [];
  return userThread.outbox.slice().sort((a, b) => a.createdAt - b.createdAt);
}

/** callee.inbox 中 source=user 的消息条数（应与 user.root.outbox 长度一致）。 */
export function userInboxIntoCallee(calleeThread: ThreadContext | undefined): ThreadMessage[] {
  if (!calleeThread?.inbox) return [];
  return calleeThread.inbox
    .filter((m) => m.source === "user")
    .slice()
    .sort((a, b) => a.createdAt - b.createdAt);
}

/**
 * 找出 thread 中对 custom window（window_id="custom:<self>"）的 exec 调用记录。
 *
 * programmable 维度专用：LLM 调自定义命令走 `exec(window_id="custom:<self>", command=<name>, args)`，
 * window_id 与 command 都在 function_call.arguments 里（见 src/executable/tools/exec.ts:91/188）。
 * 返回每次命中的 { callId, command, args }，供后续与 function_call_output 配对取结果。
 */
export function customWindowInvocations(
  thread: ThreadContext | undefined,
  selfId: string,
): Array<{ callId?: string; method?: string; args?: unknown }> {
  if (!thread) return [];
  const wantWindowId = `custom:${selfId}`;
  const hits: Array<{ callId?: string; method?: string; args?: unknown }> = [];
  for (const e of thread.events) {
    if (!isFnCall(e) || e.toolName !== "exec") continue;
    const a = (e.arguments ?? {}) as Record<string, unknown>;
    if (a.window_id !== wantWindowId) continue;
    hits.push({
      callId: (e as { callId?: string }).callId,
      method: typeof a.method === "string" ? a.method : undefined,
      args: a.args,
    });
  }
  return hits;
}

/**
 * 取某个 function_call（按 callId）对应的 function_call_output 输出字符串。
 * 用于实证 custom 命令真执行并把结果返回进 thread events（不是只发起了调用）。
 */
export function functionOutputFor(
  thread: ThreadContext | undefined,
  callId: string | undefined,
): { output?: string; ok?: boolean } {
  if (!thread || !callId) return {};
  for (const e of thread.events) {
    if (e.category !== "tool_runtime" || e.kind !== "function_call_output") continue;
    if ((e as { callId?: string }).callId !== callId) continue;
    return { output: (e as { output?: string }).output, ok: (e as { ok?: boolean }).ok };
  }
  return {};
}

export function findContextWindows(
  thread: ThreadContext | undefined,
  predicate: (w: ContextWindow) => boolean,
): ContextWindow[] {
  return ((thread?.contextWindows ?? []) as ContextWindow[]).filter(predicate);
}

// ────────────────────────────────────────────────────────────────────────────
// Stone-versioning / pool 文件观察 helpers（reflectable e2e 用）
// ────────────────────────────────────────────────────────────────────────────

/**
 * 列出某个 stone 文件（如 objects/<id>/self.md）在 stones bare repo 里的 commit 短 sha 列表。
 *
 * 走 `git -C <baseDir>/stones/.stones_repo log --oneline -- <relPathInBranch>`，
 * 实证 super flow 改 self.md 是否真经 stone-versioning 进 git。
 * relPathInBranch 形如 `objects/assistant/self.md`（相对 branch worktree 根）。
 * repo 不存在或无 commit 时返回空数组。
 */
export function stoneFileCommits(baseDir: string, relPathInBranch: string): string[] {
  const bareDir = join(baseDir, "stones", ".stones_repo");
  if (!existsSync(bareDir)) return [];
  const res = Bun.spawnSync(
    ["git", "-C", bareDir, "log", "--pretty=format:%h %an %s", "--", relPathInBranch],
    { stdout: "pipe", stderr: "pipe" },
  );
  if (res.exitCode !== 0) return [];
  const out = new TextDecoder().decode(res.stdout ?? new Uint8Array()).trim();
  return out.length === 0 ? [] : out.split("\n");
}

/** baseDir 下相对路径是否存在（pool memory 文件落盘判定）。 */
export function fileExists(baseDir: string, relPath: string): boolean {
  return existsSync(join(baseDir, relPath));
}

/**
 * 列出 super session 下某 object 的所有 thread id
 * （flows/super/objects/<self>/threads/<threadId>/）。
 * 用于实证 super flow 反思线程被创建。
 */
export function listSuperThreadIds(baseDir: string, selfId: string): string[] {
  const threadsDir = join(baseDir, "flows", "super", "objects", ...nestedObjectPath(selfId), "threads");
  if (!existsSync(threadsDir)) return [];
  try {
    return readdirSync(threadsDir);
  } catch {
    return [];
  }
}

/**
 * 等 super flow 反思线程跑到终态（done/failed），或超时返回最后状态。
 *
 * 为什么单独等：业务 thread 的 `say(target=super, wait=true)` 把反思派给一个**独立的
 * super job**——`waitForJob(业务 job)` 在业务 thread 进入 waiting 时即返回，**不**覆盖
 * super job 的执行。reflectable 的落盘副作用（写 memory / 改 self.md）发生在 super job
 * 里，所以观察前必须显式等 super thread 收尾。
 *
 * 实现：先轮询 super thread 出现，再轮询其 status ∈ {done, failed}。
 */
export async function waitForSuperFlow(
  baseDir: string,
  selfId: string,
  opts: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<{ threadId?: string; status?: string }> {
  const { readThread } = await loadDeps();
  const timeoutMs = opts.timeoutMs ?? 300_000;
  const intervalMs = opts.intervalMs ?? 1_000;
  const deadline = Date.now() + timeoutMs;
  let last: { threadId?: string; status?: string } = {};
  while (Date.now() < deadline) {
    const threadIds = listSuperThreadIds(baseDir, selfId);
    if (threadIds.length > 0) {
      // 取最近创建的一条（id 含时间编码，字典序近似时间序——足够本场景单反思请求用）
      const threadId = threadIds.slice().sort().at(-1)!;
      const thread = await readThread(
        { baseDir, sessionId: "super", objectId: selfId },
        threadId,
      );
      last = { threadId, status: thread?.status };
      if (thread?.status === "done" || thread?.status === "failed") return last;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return last;
}

/**
 * 列出 pools/<self>/knowledge/memory/ 下的 .md 文件名（仅文件名，不含路径）。
 * 用于实证 sediment 落对目录。
 */
export function listMemoryFiles(baseDir: string, selfId: string): string[] {
  const memDir = join(baseDir, "pools", ...nestedObjectPath(selfId), "knowledge", "memory");
  if (!existsSync(memDir)) return [];
  try {
    return readdirSync(memDir).filter((n) => n.endsWith(".md"));
  } catch {
    return [];
  }
}

/**
 * 粗粒度校验一篇 sediment markdown 是否含合法 frontmatter：
 * 第一行 `---`，闭合 `---`，且 block 内含 title / description / activates_on，
 * 且 activates_on 至少含一条新协议 trigger（`window::` / `method::` / `object::` / `super`）。
 *
 * 切换到 trigger map 后，旧 `show_description_when:` / `show_content_when:`
 * 不再视为有效。（reflectable 协议要求：缺 frontmatter 或写错 schema 的 memory
 * 永远无法被 activator 激活。）
 */
export function hasValidFrontmatter(md: string): boolean {
  if (!md.startsWith("---")) return false;
  const close = md.indexOf("\n---", 3);
  if (close === -1) return false;
  const block = md.slice(0, close);
  const hasTrigger =
    /window::/.test(block) || /method::/.test(block) || /object::/.test(block) || /object_id::/.test(block) || /(^|\n)\s*super:/.test(block) || /"super"/.test(block);
  return (
    /(^|\n)title:/.test(block) &&
    /(^|\n)description:/.test(block) &&
    /(^|\n)activates_on:/.test(block) &&
    hasTrigger
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Score 裁判：把可观察事实落到 Good / OK / Bad 三档
// ────────────────────────────────────────────────────────────────────────────

/**
 * 一条评分规则：name 描述含义；check() 返回 true 表示该规则"命中"。
 * - bad 规则任意命中 → Bad
 * - 否则 good 规则全命中 → Good，缺一即 OK
 */
export type ScoreRule = { name: string; check: () => boolean };

export type ScoredTier = "Good" | "OK" | "Bad";

export type ScoreResult = {
  tier: ScoredTier;
  hits: { bad: string[]; goodPassed: string[]; goodFailed: string[] };
  scenario?: string;
};

/**
 * 给一个场景打分。
 *
 * 约定：bad 规则的语义是"出现就糟糕"，good 规则的语义是"应该全部满足才算最佳"。
 * 测试断言侧只断 tier !== "Bad"；OK / Good 趋势靠 console.log(result) 留 CI 历史。
 */
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

/**
 * 把 ScoreResult 输出成 CI 友好的单行 JSON，便于 grep 历史趋势。
 * 可选 observations 携带"关键观察值"——thread.status / 命令次数 / 文件计数 等，
 * 决定档位的事实，而非过程文本。
 */
export function logScore(result: ScoreResult, observations?: Record<string, unknown>): void {
  const payload = observations ? { ...result, observations } : result;
  // 单测里允许 console.log 作为 e2e 观察孔输出（这不是产线代码）。
  // eslint-disable-next-line no-console
  console.log(`[e2e-score] ${JSON.stringify(payload)}`);
}
