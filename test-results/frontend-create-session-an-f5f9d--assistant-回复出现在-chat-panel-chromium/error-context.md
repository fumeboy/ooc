# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: frontend-create-session-and-first-reply.pw.ts >> F1 SessionCreator → 首条 assistant 回复出现在 chat panel
- Location: tests/e2e/frontend/frontend-create-session-and-first-reply.pw.ts:20:1

# Error details

```
Error: waitForHttp timed out for http://127.0.0.1:59207: TypeError: fetch failed
```

# Test source

```ts
  1   | /**
  2   |  * Frontend e2e fixture — 共享给 `tests/e2e/frontend/*.spec.ts`。
  3   |  *
  4   |  * 详见 `docs/testing/strategy.md` 与 `docs/testing/oocable-codeagent-frontend-e2e.md`。
  5   |  *
  6   |  * 启动模型（spec § 启动模型）：
  7   |  * 1. spawn 后端：bun src/app/server/index.ts --world <mkdtemp>，端口 OOC_APP_PORT=<random>
  8   |  * 2. spawn Vite dev：bun --cwd web run dev --port <random>，注 OOC_API_TARGET 指向后端
  9   |  * 3. test.extend 把 baseURL / baseDir 注入到每个 spec
  10  |  * 4. 测试结束 kill 两个进程 + rm baseDir
  11  |  *
  12  |  * 真 LLM 三件套或 RUN_FRONTEND_E2E 缺一 → fixture 在 beforeAll 抛 skip。
  13  |  */
  14  | 
  15  | import { test as base, expect, type Page } from "@playwright/test";
  16  | import { spawn, type ChildProcess } from "node:child_process";
  17  | import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
  18  | import { dirname, join, resolve } from "node:path";
  19  | import { tmpdir } from "node:os";
  20  | 
  21  | // ────────────────────────────────────────────────────────────────────────────
  22  | // .env / gate
  23  | // ────────────────────────────────────────────────────────────────────────────
  24  | 
  25  | export function loadRealEnv(): void {
  26  |   const candidates = [resolve(process.cwd(), ".env"), resolve(process.cwd(), "../../.env")];
  27  |   for (const envPath of candidates) {
  28  |     if (!existsSync(envPath)) continue;
  29  |     for (const line of readFileSync(envPath, "utf-8").split("\n")) {
  30  |       const trimmed = line.trim();
  31  |       if (!trimmed || trimmed.startsWith("#")) continue;
  32  |       const sep = trimmed.indexOf("=");
  33  |       if (sep <= 0) continue;
  34  |       const key = trimmed.slice(0, sep);
  35  |       if (process.env[key] === undefined) process.env[key] = trimmed.slice(sep + 1);
  36  |     }
  37  |     return;
  38  |   }
  39  | }
  40  | 
  41  | export const shouldRunFrontendE2E = process.env.RUN_FRONTEND_E2E === "1";
  42  | 
  43  | export function hasLlmEnv(): boolean {
  44  |   return Boolean(process.env.OOC_API_KEY && process.env.OOC_BASE_URL && process.env.OOC_MODEL);
  45  | }
  46  | 
  47  | // ────────────────────────────────────────────────────────────────────────────
  48  | // 进程 spawn helpers
  49  | // ────────────────────────────────────────────────────────────────────────────
  50  | 
  51  | function pickPort(): number {
  52  |   // 30000-60000 之间随机；fixture 自己判 readiness，不依赖此随机。
  53  |   return 30_000 + Math.floor(Math.random() * 30_000);
  54  | }
  55  | 
  56  | async function waitForHttp(url: string, timeoutMs = 30_000, intervalMs = 250): Promise<void> {
  57  |   const deadline = Date.now() + timeoutMs;
  58  |   let lastErr: unknown;
  59  |   while (Date.now() < deadline) {
  60  |     try {
  61  |       const res = await fetch(url, { method: "GET" });
  62  |       if (res.ok) return;
  63  |       lastErr = new Error(`HTTP ${res.status}`);
  64  |     } catch (err) {
  65  |       lastErr = err;
  66  |     }
  67  |     await new Promise((r) => setTimeout(r, intervalMs));
  68  |   }
> 69  |   throw new Error(`waitForHttp timed out for ${url}: ${String(lastErr)}`);
      |         ^ Error: waitForHttp timed out for http://127.0.0.1:59207: TypeError: fetch failed
  70  | }
  71  | 
  72  | type SpawnedProcess = {
  73  |   proc: ChildProcess;
  74  |   kill: () => Promise<void>;
  75  | };
  76  | 
  77  | function killGracefully(proc: ChildProcess): Promise<void> {
  78  |   return new Promise((resolveKill) => {
  79  |     if (proc.exitCode !== null || proc.signalCode !== null) {
  80  |       resolveKill();
  81  |       return;
  82  |     }
  83  |     const onExit = () => resolveKill();
  84  |     proc.once("exit", onExit);
  85  |     proc.kill("SIGTERM");
  86  |     setTimeout(() => {
  87  |       if (proc.exitCode === null) proc.kill("SIGKILL");
  88  |     }, 3_000);
  89  |   });
  90  | }
  91  | 
  92  | // ────────────────────────────────────────────────────────────────────────────
  93  | // Backend / Vite 启动
  94  | // ────────────────────────────────────────────────────────────────────────────
  95  | 
  96  | export type SeedFile = { path: string; content: string };
  97  | export type SeedStone = { objectId: string; self?: string; readme?: string };
  98  | 
  99  | function seedBaseDir(baseDir: string, opts: { seedFiles?: SeedFile[]; seedStones?: SeedStone[] }) {
  100 |   for (const file of opts.seedFiles ?? []) {
  101 |     const abs = join(baseDir, file.path);
  102 |     mkdirSync(dirname(abs), { recursive: true });
  103 |     writeFileSync(abs, file.content, "utf8");
  104 |   }
  105 |   for (const stone of opts.seedStones ?? []) {
  106 |     const stoneDir = join(baseDir, "stones", stone.objectId);
  107 |     mkdirSync(join(stoneDir, "knowledge"), { recursive: true });
  108 |     writeFileSync(
  109 |       join(stoneDir, ".stone.json"),
  110 |       JSON.stringify({ objectId: stone.objectId, name: stone.objectId, createdAt: Date.now() }, null, 2),
  111 |       "utf8",
  112 |     );
  113 |     if (stone.self !== undefined) writeFileSync(join(stoneDir, "self.md"), stone.self, "utf8");
  114 |     if (stone.readme !== undefined) writeFileSync(join(stoneDir, "readme.md"), stone.readme, "utf8");
  115 |   }
  116 | }
  117 | 
  118 | export type BackendHandle = SpawnedProcess & {
  119 |   port: number;
  120 |   baseDir: string;
  121 |   baseURL: string;
  122 | };
  123 | 
  124 | export async function startBackend(opts: {
  125 |   seedFiles?: SeedFile[];
  126 |   seedStones?: SeedStone[];
  127 | } = {}): Promise<BackendHandle> {
  128 |   const baseDir = mkdtempSync(join(tmpdir(), "ooc-e2e-fe-"));
  129 |   seedBaseDir(baseDir, opts);
  130 | 
  131 |   const port = pickPort();
  132 |   const repoRoot = resolve(process.cwd());
  133 |   const proc = spawn(
  134 |     "bun",
  135 |     [join(repoRoot, "src/app/server/index.ts"), "--world", baseDir],
  136 |     {
  137 |       cwd: repoRoot,
  138 |       env: {
  139 |         ...process.env,
  140 |         OOC_APP_PORT: String(port),
  141 |         // 默认 worker tick 数偏低；前端 e2e 任务可能更长。
  142 |         OOC_WORKER_MAX_TICKS: "30",
  143 |         OOC_WORKER_POLL_MS: "50",
  144 |       },
  145 |       stdio: ["ignore", "pipe", "pipe"],
  146 |     },
  147 |   );
  148 | 
  149 |   // 把 backend 输出附到 stderr，便于排查（spec 失败时翻 trace）。
  150 |   proc.stdout?.on("data", (chunk) => process.stderr.write(`[backend stdout] ${chunk}`));
  151 |   proc.stderr?.on("data", (chunk) => process.stderr.write(`[backend stderr] ${chunk}`));
  152 | 
  153 |   const baseURL = `http://127.0.0.1:${port}`;
  154 |   try {
  155 |     await waitForHttp(`${baseURL}/api/health`, 30_000);
  156 |   } catch (err) {
  157 |     await killGracefully(proc);
  158 |     rmSync(baseDir, { recursive: true, force: true });
  159 |     throw err;
  160 |   }
  161 | 
  162 |   return {
  163 |     proc,
  164 |     port,
  165 |     baseDir,
  166 |     baseURL,
  167 |     kill: async () => {
  168 |       await killGracefully(proc);
  169 |       try {
```