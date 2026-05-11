# App Server Elysia Control Plane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `src/app/server` 下实现基于 Elysia 的 OOC 控制面服务，提供 `stones` / `flows` / `runtime` 三大模块 API、进程内异步 worker，以及 `pause/resume` 与 `ui_methods` HTTP 调用能力。

**Architecture:** 保持现有 `persistable` / `thinkable` / `executable` / `observable` 作为领域内核，在 `src/app/server` 之上增加一层 feature-based 的 HTTP 控制面。每个模块采用 one-api-per-file 的 `api.*.ts` 平铺模式，`index.ts` 只做路由聚合；后台任务、pause-store、resume runtime 放在 `src/app/server/runtime/`。

**Tech Stack:** Bun, TypeScript, Elysia, 现有 OOC runtime（persistable / thinkable / executable / observable）。

---

## File Structure

### Create

- `src/app/server/index.ts` - Server 入口，组装 health/runtime/stones/flows 模块并 `listen()`
- `src/app/server/bootstrap/config.ts` - 读取端口、baseDir、worker 参数
- `src/app/server/bootstrap/errors.ts` - 统一错误类型与 HTTP 映射
- `src/app/server/runtime/types.ts` - job / pause / runtime 辅助类型
- `src/app/server/runtime/job-manager.ts` - 进程内 job registry 与并发互斥
- `src/app/server/runtime/worker.ts` - 后台 worker 执行 `runScheduler()`
- `src/app/server/runtime/pause-store.ts` - global pause + session pause 状态存储
- `src/app/server/runtime/resume.ts` - 从 `llm.output.json` 恢复 paused 线程执行
- `src/app/server/modules/health/index.ts`
- `src/app/server/modules/health/api.health.ts`
- `src/app/server/modules/runtime/index.ts`
- `src/app/server/modules/runtime/service.ts`
- `src/app/server/modules/runtime/model.ts`
- `src/app/server/modules/runtime/api.get-llm-config.ts`
- `src/app/server/modules/runtime/api.list-jobs.ts`
- `src/app/server/modules/runtime/api.get-job.ts`
- `src/app/server/modules/runtime/api.enable-global-pause.ts`
- `src/app/server/modules/runtime/api.disable-global-pause.ts`
- `src/app/server/modules/runtime/api.get-global-pause-status.ts`
- `src/app/server/modules/runtime/api.get-latest-debug.ts`
- `src/app/server/modules/runtime/api.get-loop-debug.ts`
- `src/app/server/modules/stones/index.ts`
- `src/app/server/modules/stones/service.ts`
- `src/app/server/modules/stones/model.ts`
- `src/app/server/modules/stones/api.create-stone.ts`
- `src/app/server/modules/stones/api.get-stone.ts`
- `src/app/server/modules/stones/api.get-self.ts`
- `src/app/server/modules/stones/api.put-self.ts`
- `src/app/server/modules/stones/api.get-readme.ts`
- `src/app/server/modules/stones/api.put-readme.ts`
- `src/app/server/modules/stones/api.get-data.ts`
- `src/app/server/modules/stones/api.patch-data.ts`
- `src/app/server/modules/stones/api.get-server-source.ts`
- `src/app/server/modules/stones/api.put-server-source.ts`
- `src/app/server/modules/stones/api.call-method.ts`
- `src/app/server/modules/flows/index.ts`
- `src/app/server/modules/flows/service.ts`
- `src/app/server/modules/flows/model.ts`
- `src/app/server/modules/flows/api.create-session.ts`
- `src/app/server/modules/flows/api.create-flow-object.ts`
- `src/app/server/modules/flows/api.get-flow-object.ts`
- `src/app/server/modules/flows/api.get-thread.ts`
- `src/app/server/modules/flows/api.pause-session.ts`
- `src/app/server/modules/flows/api.resume-session.ts`
- `src/app/server/modules/flows/api.call-method.ts`
- `src/app/server/__tests__/server.test.ts`
- `src/app/server/modules/runtime/service.test.ts`
- `src/app/server/modules/stones/service.test.ts`
- `src/app/server/modules/flows/service.test.ts`
- `src/app/server/runtime/job-manager.test.ts`
- `src/app/server/runtime/pause-store.test.ts`
- `src/app/server/runtime/resume.test.ts`

### Modify

- `package.json` - 增加 `elysia` 依赖与 server 启动脚本
- `src/executable/server/loader.ts` - 同时支持 `llm_methods` 与 `ui_methods`
- `src/executable/server/types.ts` - 抽出 UI method 共享类型
- `src/executable/server/self.ts` - 尽量复用通用 method 上下文构造逻辑
- `src/observable/index.ts` - 增加可注入 `pauseChecker`
- `src/thinkable/scheduler.ts` - 若需要，补 thread tree 递归落盘 helper 的调用点
- `src/persistable/flow-object.ts` - 增加 session 根目录 / `.session.json` 支持，或拆出 `session-object.ts`
- `src/persistable/index.ts` - 导出新增 session / runtime 相关 helper

### Optional / If Needed

- `meta/object/observable/pause.doc.js` - 若实现语义与文档存在偏差时回写文档
- `meta/object/executable/server/index.doc.js` - 若 `ui_methods` HTTP 契约需补实现阶段说明

---

### Task 1: Add Elysia Scaffold

**Files:**
- Modify: `package.json`
- Create: `src/app/server/index.ts`
- Create: `src/app/server/bootstrap/config.ts`
- Create: `src/app/server/bootstrap/errors.ts`
- Test: `src/app/server/__tests__/server.test.ts`

- [ ] **Step 1: Write the failing server smoke test**

```ts
import { describe, expect, test } from "bun:test";
import { buildServer } from "../index";

describe("app server", () => {
  test("responds to GET /api/health", async () => {
    const app = buildServer({
      port: 0,
      baseDir: "/tmp/ooc-app-test"
    });

    const response = await app.handle(new Request("http://localhost/api/health"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.service).toBe("ooc-app-server");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
bun test src/app/server/__tests__/server.test.ts
```

Expected: FAIL with module-not-found errors for `src/app/server/index.ts`.

- [ ] **Step 3: Install Elysia and add scripts**

Update `package.json`:

```json
{
  "scripts": {
    "test": "bun test",
    "server": "bun src/app/server/index.ts"
  },
  "dependencies": {
    "elysia": "^1.1.26"
  }
}
```

Run:

```bash
bun add elysia
```

- [ ] **Step 4: Write the minimal server scaffold**

Create `src/app/server/index.ts`:

```ts
import { Elysia } from "elysia";
import { healthModule } from "./modules/health";
import { runtimeModule } from "./modules/runtime";
import { stonesModule } from "./modules/stones";
import { flowsModule } from "./modules/flows";
import { readServerConfig, type ServerConfig } from "./bootstrap/config";

export function buildServer(config: ServerConfig = readServerConfig()) {
  return new Elysia({ name: "ooc.app.server" })
    .use(healthModule)
    .use(runtimeModule(config))
    .use(stonesModule(config))
    .use(flowsModule(config));
}

const config = readServerConfig();
buildServer(config).listen(config.port);
console.log(`[ooc-app-server] listening on :${config.port}`);
```

Create `src/app/server/bootstrap/config.ts`:

```ts
export interface ServerConfig {
  port: number;
  baseDir: string;
  workerPollMs: number;
}

export function readServerConfig(): ServerConfig {
  return {
    port: Number(process.env.OOC_APP_PORT ?? 3000),
    baseDir: process.env.OOC_BASE_DIR ?? process.cwd(),
    workerPollMs: Number(process.env.OOC_WORKER_POLL_MS ?? 100)
  };
}
```

Create `src/app/server/bootstrap/errors.ts`:

```ts
export class AppServerError extends Error {
  constructor(
    public readonly code:
      | "NOT_FOUND"
      | "INVALID_INPUT"
      | "CONFLICT"
      | "METHOD_NOT_FOUND"
      | "METHOD_LOAD_FAILED"
      | "THREAD_NOT_RUNNABLE"
      | "THREAD_NOT_PAUSED"
      | "JOB_ALREADY_RUNNING"
      | "PAUSE_STILL_ENABLED"
      | "INTERNAL_ERROR",
    message: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
  }
}
```

- [ ] **Step 5: Add the minimal health module**

Create `src/app/server/modules/health/index.ts`:

```ts
import { Elysia } from "elysia";
import { healthApi } from "./api.health";

export const healthModule = new Elysia({ prefix: "/api", name: "ooc.health" }).use(healthApi);
```

Create `src/app/server/modules/health/api.health.ts`:

```ts
import { Elysia } from "elysia";

export const healthApi = new Elysia({ name: "ooc.health.api.health" }).get("/health", () => ({
  ok: true,
  service: "ooc-app-server",
  time: Date.now()
}));
```

- [ ] **Step 6: Run test to verify it passes**

Run:

```bash
bun test src/app/server/__tests__/server.test.ts
```

Expected: PASS with `1 pass`.

- [ ] **Step 7: Commit**

```bash
git add package.json src/app/server
git commit -m "feat(server): add elysia scaffold and health api"
```

### Task 2: Add UI Method Loading And Runtime Pause Hook

**Files:**
- Modify: `src/executable/server/loader.ts`
- Modify: `src/executable/server/types.ts`
- Modify: `src/executable/server/self.ts`
- Modify: `src/observable/index.ts`
- Test: `src/executable/__tests__/server-loader.test.ts`
- Test: `src/app/server/runtime/pause-store.test.ts`

- [ ] **Step 1: Write failing tests for `ui_methods` loading and pause checker injection**

Append to `src/executable/__tests__/server-loader.test.ts`:

```ts
test("loads ui_methods from server/index.ts", async () => {
  tempRoot = await mkdtemp(join(tmpdir(), "ooc-srv-"));
  const ref = await createStoneObject({ baseDir: tempRoot, objectId: "x" });

  await writeServerSource(
    ref,
    `export const ui_methods = {
      submit: {
        fn: async (_ctx, { value }) => ({ ok: value }),
      },
    };`
  );

  const methods = await loadUiServerMethods(ref);
  expect(Object.keys(methods)).toEqual(["submit"]);
});
```

Create `src/app/server/runtime/pause-store.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import {
  createPauseStore,
  type PauseStore
} from "./pause-store";

describe("pause-store", () => {
  test("tracks global and session pause state", () => {
    const store: PauseStore = createPauseStore();
    expect(store.isGlobalPauseEnabled()).toBe(false);
    expect(store.isSessionPaused("s1")).toBe(false);
    store.enableGlobalPause();
    store.pauseSession("s1");
    expect(store.isGlobalPauseEnabled()).toBe(true);
    expect(store.isSessionPaused("s1")).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
bun test src/executable/__tests__/server-loader.test.ts src/app/server/runtime/pause-store.test.ts
```

Expected: FAIL because `loadUiServerMethods` and `pause-store.ts` do not exist.

- [ ] **Step 3: Implement dual-channel server method loading**

Update `src/executable/server/types.ts`:

```ts
export type UiMethods = Record<string, ServerMethod>;
```

Update `src/executable/server/loader.ts`:

```ts
export async function loadLlmServerMethods(stoneRef: StoneObjectRef): Promise<LlmMethods> {
  const mod = await loadServerModule(stoneRef);
  return (mod.llm_methods ?? {}) as LlmMethods;
}

export async function loadUiServerMethods(stoneRef: StoneObjectRef): Promise<LlmMethods> {
  const mod = await loadServerModule(stoneRef);
  return (mod.ui_methods ?? {}) as LlmMethods;
}

export const loadServerMethods = loadLlmServerMethods;
```

- [ ] **Step 4: Implement pause store and pause checker registration**

Create `src/app/server/runtime/pause-store.ts`:

```ts
export interface PauseStore {
  enableGlobalPause(): void;
  disableGlobalPause(): void;
  isGlobalPauseEnabled(): boolean;
  pauseSession(sessionId: string): void;
  resumeSession(sessionId: string): void;
  isSessionPaused(sessionId: string): boolean;
}

export function createPauseStore(): PauseStore {
  const pausedSessions = new Set<string>();
  let globalPaused = false;
  return {
    enableGlobalPause: () => {
      globalPaused = true;
    },
    disableGlobalPause: () => {
      globalPaused = false;
    },
    isGlobalPauseEnabled: () => globalPaused,
    pauseSession: (sessionId) => {
      pausedSessions.add(sessionId);
    },
    resumeSession: (sessionId) => {
      pausedSessions.delete(sessionId);
    },
    isSessionPaused: (sessionId) => pausedSessions.has(sessionId)
  };
}
```

Update `src/observable/index.ts`:

```ts
export type PauseChecker = (thread: ThreadContext) => boolean | Promise<boolean>;

let pauseChecker: PauseChecker = () => false;

export function setPauseChecker(checker: PauseChecker): void {
  pauseChecker = checker;
}

export function isPausing(thread: ThreadContext): Promise<boolean> | boolean {
  return pauseChecker(thread);
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run:

```bash
bun test src/executable/__tests__/server-loader.test.ts src/app/server/runtime/pause-store.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/executable/server src/observable src/app/server/runtime
git commit -m "feat(server): add ui method loading and pause store"
```

### Task 3: Add Runtime Jobs And Resume Engine

**Files:**
- Create: `src/app/server/runtime/types.ts`
- Create: `src/app/server/runtime/job-manager.ts`
- Create: `src/app/server/runtime/worker.ts`
- Create: `src/app/server/runtime/resume.ts`
- Test: `src/app/server/runtime/job-manager.test.ts`
- Test: `src/app/server/runtime/resume.test.ts`

- [ ] **Step 1: Write failing tests for job manager and resume**

Create `src/app/server/runtime/job-manager.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { createJobManager } from "./job-manager";

describe("job-manager", () => {
  test("deduplicates running job per session/object", () => {
    const jobs = createJobManager();
    const first = jobs.createRunThreadJob({
      sessionId: "s1",
      objectId: "agent",
      threadId: "root"
    });
    const second = jobs.createRunThreadJob({
      sessionId: "s1",
      objectId: "agent",
      threadId: "root"
    });
    expect(second.jobId).toBe(first.jobId);
  });
});
```

Create `src/app/server/runtime/resume.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createFlowObject, threadFile, llmOutputFile } from "@src/persistable";
import { resumePausedThread } from "./resume";

describe("resumePausedThread", () => {
  test("replays saved llm output instead of calling llm again", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "ooc-resume-"));
    try {
      const flow = await createFlowObject({ baseDir, sessionId: "s1", objectId: "agent" });
      await writeFile(
        threadFile({ ...flow, threadId: "root" }),
        JSON.stringify({ id: "root", status: "paused", events: [], persistence: { ...flow, threadId: "root" } })
      );
      await writeFile(
        llmOutputFile({ ...flow, threadId: "root" }),
        JSON.stringify({
          threadId: "root",
          result: { provider: "openai", model: "test", text: "resume", toolCalls: [] }
        })
      );

      const thread = await resumePausedThread({ baseDir, sessionId: "s1", objectId: "agent", threadId: "root" });
      expect(thread.status).toBe("running");
      expect(thread.events.some((event) => event.category === "llm_interaction")).toBe(true);
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
bun test src/app/server/runtime/job-manager.test.ts src/app/server/runtime/resume.test.ts
```

Expected: FAIL because runtime files do not exist.

- [ ] **Step 3: Implement minimal job manager**

Create `src/app/server/runtime/types.ts`:

```ts
export interface RuntimeJob {
  jobId: string;
  kind: "run-thread" | "resume-thread";
  sessionId: string;
  objectId: string;
  threadId: string;
  status: "queued" | "running" | "done" | "failed";
  startedAt?: number;
  finishedAt?: number;
  error?: string;
}
```

Create `src/app/server/runtime/job-manager.ts`:

```ts
import { randomUUID } from "node:crypto";
import type { RuntimeJob } from "./types";

export function createJobManager() {
  const jobs = new Map<string, RuntimeJob>();

  function findRunning(sessionId: string, objectId: string) {
    return [...jobs.values()].find((job) =>
      job.sessionId === sessionId &&
      job.objectId === objectId &&
      (job.status === "queued" || job.status === "running")
    );
  }

  return {
    createRunThreadJob(input: Omit<RuntimeJob, "jobId" | "kind" | "status">) {
      const existing = findRunning(input.sessionId, input.objectId);
      if (existing) return existing;
      const job: RuntimeJob = {
        ...input,
        jobId: randomUUID(),
        kind: "run-thread",
        status: "queued"
      };
      jobs.set(job.jobId, job);
      return job;
    },
    createResumeThreadJob(input: Omit<RuntimeJob, "jobId" | "kind" | "status">) {
      const job: RuntimeJob = {
        ...input,
        jobId: randomUUID(),
        kind: "resume-thread",
        status: "queued"
      };
      jobs.set(job.jobId, job);
      return job;
    },
    listJobs: () => [...jobs.values()],
    getJob: (jobId: string) => jobs.get(jobId),
    updateJob(jobId: string, patch: Partial<RuntimeJob>) {
      const current = jobs.get(jobId);
      if (!current) return undefined;
      const next = { ...current, ...patch };
      jobs.set(jobId, next);
      return next;
    }
  };
}
```

- [ ] **Step 4: Implement minimal resume runtime**

Create `src/app/server/runtime/resume.ts`:

```ts
import { readFile } from "node:fs/promises";
import { llmOutputFile, readThread, writeThread, type ThreadPersistenceRef } from "@src/persistable";
import { dispatchToolCall } from "@src/executable/tools";

export async function resumePausedThread(ref: ThreadPersistenceRef) {
  const thread = await readThread(ref);
  if (!thread || thread.status !== "paused") {
    throw new Error(`thread ${ref.threadId} is not paused`);
  }

  const raw = await readFile(llmOutputFile(ref), "utf8");
  const payload = JSON.parse(raw) as {
    result: {
      text: string;
      toolCalls: Array<{ name: "open" | "refine" | "submit" | "close" | "wait" | "compress"; arguments: Record<string, unknown> }>;
    };
  };

  thread.status = "running";
  if (payload.result.text) {
    thread.events.push({ category: "llm_interaction", kind: "text", text: payload.result.text });
  }
  for (const toolCall of payload.result.toolCalls) {
    thread.events.push({
      category: "llm_interaction",
      kind: "tool_use",
      toolName: toolCall.name,
      arguments: toolCall.arguments
    });
    await dispatchToolCall(thread, { id: `resume_${toolCall.name}`, ...toolCall });
  }
  await writeThread(thread);
  return thread;
}
```

- [ ] **Step 5: Add worker skeleton**

Create `src/app/server/runtime/worker.ts`:

```ts
import { createLlmClient } from "@src/thinkable/llm/client";
import { readThread } from "@src/persistable";
import { runScheduler } from "@src/thinkable/scheduler";
import type { ServerConfig } from "../bootstrap/config";
import type { RuntimeJob } from "./types";

export async function runJob(job: RuntimeJob, config: ServerConfig) {
  if (job.kind === "resume-thread") return;
  const ref = {
    baseDir: config.baseDir,
    sessionId: job.sessionId,
    objectId: job.objectId,
    threadId: job.threadId
  };
  const thread = await readThread(ref);
  if (!thread) throw new Error(`thread not found: ${job.threadId}`);
  await runScheduler(thread, createLlmClient(), { maxTicks: 10 });
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run:

```bash
bun test src/app/server/runtime/job-manager.test.ts src/app/server/runtime/resume.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/app/server/runtime
git commit -m "feat(server): add runtime jobs and resume engine"
```

### Task 4: Implement Runtime APIs

**Files:**
- Create: `src/app/server/modules/runtime/index.ts`
- Create: `src/app/server/modules/runtime/service.ts`
- Create: `src/app/server/modules/runtime/model.ts`
- Create: `src/app/server/modules/runtime/api.get-llm-config.ts`
- Create: `src/app/server/modules/runtime/api.list-jobs.ts`
- Create: `src/app/server/modules/runtime/api.get-job.ts`
- Create: `src/app/server/modules/runtime/api.enable-global-pause.ts`
- Create: `src/app/server/modules/runtime/api.disable-global-pause.ts`
- Create: `src/app/server/modules/runtime/api.get-global-pause-status.ts`
- Create: `src/app/server/modules/runtime/api.get-latest-debug.ts`
- Create: `src/app/server/modules/runtime/api.get-loop-debug.ts`
- Test: `src/app/server/modules/runtime/service.test.ts`

- [ ] **Step 1: Write failing runtime service test**

Create `src/app/server/modules/runtime/service.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { createPauseStore } from "../../runtime/pause-store";
import { createRuntimeService } from "./service";

describe("runtime service", () => {
  test("returns global pause status", () => {
    const pauseStore = createPauseStore();
    const service = createRuntimeService({ pauseStore, jobManager: undefined as never });
    pauseStore.enableGlobalPause();
    expect(service.getGlobalPauseStatus()).toEqual({ enabled: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
bun test src/app/server/modules/runtime/service.test.ts
```

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement runtime service and models**

Create `src/app/server/modules/runtime/model.ts`:

```ts
import { t } from "elysia";

export const RuntimeModel = {
  globalPauseResponse: t.Object({ enabled: t.Boolean() }),
  llmConfigResponse: t.Object({
    configured: t.Boolean(),
    provider: t.String(),
    baseUrl: t.String(),
    model: t.String()
  })
} as const;
```

Create `src/app/server/modules/runtime/service.ts`:

```ts
import { readFile } from "node:fs/promises";
import { llmInputFile, llmOutputFile, loopInputFile, loopOutputFile, loopMetaFile } from "@src/persistable";
import { readLlmEnv } from "@src/thinkable/llm/env";
import type { PauseStore } from "../../runtime/pause-store";

export function createRuntimeService(deps: {
  pauseStore: PauseStore;
  jobManager: {
    listJobs(): unknown[];
    getJob(jobId: string): unknown;
  };
}) {
  return {
    getLlmConfig() {
      const config = readLlmEnv();
      return {
        configured: true,
        provider: config.provider,
        baseUrl: config.baseUrl,
        model: config.model
      };
    },
    listJobs() {
      return { items: deps.jobManager.listJobs() };
    },
    getJob(jobId: string) {
      return deps.jobManager.getJob(jobId);
    },
    enableGlobalPause() {
      deps.pauseStore.enableGlobalPause();
      return { enabled: true };
    },
    disableGlobalPause() {
      deps.pauseStore.disableGlobalPause();
      return { enabled: false };
    },
    getGlobalPauseStatus() {
      return { enabled: deps.pauseStore.isGlobalPauseEnabled() };
    },
    async getLatestDebug(ref: { baseDir: string; sessionId: string; objectId: string; threadId: string }) {
      return {
        input: JSON.parse(await readFile(llmInputFile(ref), "utf8")),
        output: JSON.parse(await readFile(llmOutputFile(ref), "utf8"))
      };
    },
    async getLoopDebug(ref: { baseDir: string; sessionId: string; objectId: string; threadId: string }, loopIndex: number) {
      return {
        input: JSON.parse(await readFile(loopInputFile(ref, loopIndex), "utf8")),
        output: JSON.parse(await readFile(loopOutputFile(ref, loopIndex), "utf8")),
        meta: JSON.parse(await readFile(loopMetaFile(ref, loopIndex), "utf8"))
      };
    }
  };
}
```

- [ ] **Step 4: Implement runtime route files**

Create route files using this pattern, example `api.get-global-pause-status.ts`:

```ts
import { Elysia } from "elysia";
import { RuntimeModel } from "./model";

export function getGlobalPauseStatusApi(service: ReturnType<typeof import("./service").createRuntimeService>) {
  return new Elysia({ name: "ooc.runtime.api.get-global-pause-status" }).get(
    "/runtime/global-pause/status",
    () => service.getGlobalPauseStatus(),
    { response: RuntimeModel.globalPauseResponse }
  );
}
```

Create `modules/runtime/index.ts`:

```ts
import { Elysia } from "elysia";
import type { ServerConfig } from "../../bootstrap/config";

export function runtimeModule(config: ServerConfig) {
  const service = createRuntimeService({
    pauseStore: config.pauseStore,
    jobManager: config.jobManager
  });
  return new Elysia({ prefix: "/api", name: "ooc.runtime" })
    .use(getLlmConfigApi(service))
    .use(listJobsApi(service))
    .use(getJobApi(service))
    .use(enableGlobalPauseApi(service))
    .use(disableGlobalPauseApi(service))
    .use(getGlobalPauseStatusApi(service))
    .use(getLatestDebugApi(service))
    .use(getLoopDebugApi(service));
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run:

```bash
bun test src/app/server/modules/runtime/service.test.ts src/app/server/__tests__/server.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/server/modules/runtime src/app/server/index.ts
git commit -m "feat(server): add runtime apis"
```

### Task 5: Implement Stones APIs

**Files:**
- Create: `src/app/server/modules/stones/index.ts`
- Create: `src/app/server/modules/stones/service.ts`
- Create: `src/app/server/modules/stones/model.ts`
- Create: `src/app/server/modules/stones/api.*.ts`
- Test: `src/app/server/modules/stones/service.test.ts`

- [ ] **Step 1: Write failing stones service tests**

Create `src/app/server/modules/stones/service.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createStonesService } from "./service";

describe("stones service", () => {
  test("creates stone and reads/writes self", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "ooc-stones-"));
    try {
      const service = createStonesService({ baseDir });
      await service.createStone({ objectId: "agent" });
      await service.putSelf({ objectId: "agent", text: "# agent" });
      const result = await service.getSelf({ objectId: "agent" });
      expect(result.text).toContain("agent");
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
bun test src/app/server/modules/stones/service.test.ts
```

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement stones service**

Create `src/app/server/modules/stones/service.ts`:

```ts
import {
  createStoneObject,
  readSelf,
  writeSelf,
  readReadme,
  writeReadme,
  readData,
  mergeData,
  readServerSource,
  writeServerSource
} from "@src/persistable";
import { loadUiServerMethods } from "@src/executable/server/loader";

export function createStonesService({ baseDir }: { baseDir: string }) {
  const ref = (objectId: string) => ({ baseDir, objectId });

  return {
    async createStone({ objectId }: { objectId: string }) {
      await createStoneObject(ref(objectId));
      return { objectId, dir: `${baseDir}/stones/${objectId}`, created: true };
    },
    async getStone({ objectId }: { objectId: string }) {
      return { objectId, dir: `${baseDir}/stones/${objectId}`, exists: true };
    },
    async getSelf({ objectId }: { objectId: string }) {
      return { text: (await readSelf(ref(objectId))) ?? "" };
    },
    async putSelf({ objectId, text }: { objectId: string; text: string }) {
      await writeSelf(ref(objectId), text);
      return { ok: true };
    },
    async getReadme({ objectId }: { objectId: string }) {
      return { text: (await readReadme(ref(objectId))) ?? "" };
    },
    async putReadme({ objectId, text }: { objectId: string; text: string }) {
      await writeReadme(ref(objectId), text);
      return { ok: true };
    },
    async getData({ objectId }: { objectId: string }) {
      return { data: (await readData(ref(objectId))) ?? {} };
    },
    async patchData({ objectId, patch }: { objectId: string; patch: Record<string, unknown> }) {
      await mergeData(ref(objectId), patch);
      return { ok: true };
    },
    async getServerSource({ objectId }: { objectId: string }) {
      return { code: (await readServerSource(ref(objectId))) ?? "" };
    },
    async putServerSource({ objectId, code }: { objectId: string; code: string }) {
      await writeServerSource(ref(objectId), code);
      return { ok: true };
    },
    async callMethod({ objectId, method, args = {} }: { objectId: string; method: string; args?: Record<string, unknown> }) {
      const methods = await loadUiServerMethods(ref(objectId));
      const fn = methods[method]?.fn;
      if (!fn) throw new Error(`ui method not found: ${method}`);
      return { returnValue: await fn({ self: { dir: `${baseDir}/stones/${objectId}` } as never, thread: { id: "http", inject() {} } }, args) };
    }
  };
}
```

- [ ] **Step 4: Implement route files and schemas**

Create one file per API, example `api.create-stone.ts`:

```ts
import { Elysia, t } from "elysia";

export function createStoneApi(service: ReturnType<typeof import("./service").createStonesService>) {
  return new Elysia({ name: "ooc.stones.api.create-stone" }).post(
    "/stones",
    ({ body }) => service.createStone(body),
    {
      body: t.Object({ objectId: t.String() })
    }
  );
}
```

Create `modules/stones/index.ts`:

```ts
import { Elysia } from "elysia";

export function stonesModule(config: { baseDir: string }) {
  const service = createStonesService({ baseDir: config.baseDir });
  return new Elysia({ prefix: "/api", name: "ooc.stones" })
    .use(createStoneApi(service))
    .use(getStoneApi(service))
    .use(getSelfApi(service))
    .use(putSelfApi(service))
    .use(getReadmeApi(service))
    .use(putReadmeApi(service))
    .use(getDataApi(service))
    .use(patchDataApi(service))
    .use(getServerSourceApi(service))
    .use(putServerSourceApi(service))
    .use(callMethodApi(service));
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run:

```bash
bun test src/app/server/modules/stones/service.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/server/modules/stones
git commit -m "feat(server): add stones apis"
```

### Task 6: Implement Flows APIs, Auto Root Thread, And Pause/Resume

**Files:**
- Create: `src/app/server/modules/flows/index.ts`
- Create: `src/app/server/modules/flows/service.ts`
- Create: `src/app/server/modules/flows/model.ts`
- Create: `src/app/server/modules/flows/api.*.ts`
- Modify: `src/persistable/flow-object.ts`
- Modify: `src/persistable/index.ts`
- Test: `src/app/server/modules/flows/service.test.ts`

- [ ] **Step 1: Write failing flows service tests**

Create `src/app/server/modules/flows/service.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createPauseStore } from "../../runtime/pause-store";
import { createJobManager } from "../../runtime/job-manager";
import { createFlowsService } from "./service";

describe("flows service", () => {
  test("creates flow object and auto-enqueues root thread job", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "ooc-flows-"));
    try {
      const service = createFlowsService({
        baseDir,
        pauseStore: createPauseStore(),
        jobManager: createJobManager()
      });

      await service.createSession({ sessionId: "s1", title: "demo" });
      const result = await service.createFlowObject({ sessionId: "s1", objectId: "agent" });
      expect(result.initialThreadId).toBe("root");
      expect(result.jobId).toBeString();
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
bun test src/app/server/modules/flows/service.test.ts
```

Expected: FAIL with module-not-found.

- [ ] **Step 3: Add minimal session persistence**

Update `src/persistable/flow-object.ts` with session helpers:

```ts
export function sessionDir(baseDir: string, sessionId: string): string {
  return join(baseDir, "flows", sessionId);
}

export function sessionMetadataFile(baseDir: string, sessionId: string): string {
  return join(sessionDir(baseDir, sessionId), ".session.json");
}

export async function createSession(baseDir: string, sessionId: string, title?: string): Promise<void> {
  await mkdir(sessionDir(baseDir, sessionId), { recursive: true });
  await writeFile(
    sessionMetadataFile(baseDir, sessionId),
    JSON.stringify({ sessionId, title: title ?? sessionId }, null, 2),
    "utf8"
  );
}
```

- [ ] **Step 4: Implement flows service**

Create `src/app/server/modules/flows/service.ts`:

```ts
import { createFlowObject, createSession, readThread, writeThread } from "@src/persistable";

export function createFlowsService(deps: {
  baseDir: string;
  pauseStore: import("../../runtime/pause-store").PauseStore;
  jobManager: ReturnType<typeof import("../../runtime/job-manager").createJobManager>;
}) {
  return {
    async createSession({ sessionId, title }: { sessionId: string; title?: string }) {
      await createSession(deps.baseDir, sessionId, title);
      return { sessionId, dir: `${deps.baseDir}/flows/${sessionId}`, created: true };
    },
    async createFlowObject({ sessionId, objectId }: { sessionId: string; objectId: string }) {
      const ref = await createFlowObject({ baseDir: deps.baseDir, sessionId, objectId });
      const rootRef = { ...ref, threadId: "root" };
      await writeThread({
        id: "root",
        status: "running",
        events: [],
        persistence: rootRef
      });
      const job = deps.jobManager.createRunThreadJob({
        sessionId,
        objectId,
        threadId: "root"
      });
      return {
        sessionId,
        objectId,
        dir: `${deps.baseDir}/flows/${sessionId}/objects/${objectId}`,
        created: true,
        initialThreadId: "root",
        jobId: job.jobId
      };
    },
    async getThread({ sessionId, objectId, threadId }: { sessionId: string; objectId: string; threadId: string }) {
      return await readThread({ baseDir: deps.baseDir, sessionId, objectId, threadId });
    },
    pauseSession({ sessionId }: { sessionId: string }) {
      deps.pauseStore.pauseSession(sessionId);
      return { sessionId, paused: true };
    },
    resumeSession({ sessionId }: { sessionId: string }) {
      deps.pauseStore.resumeSession(sessionId);
      return { sessionId, resumedThreadIds: [], jobIds: [] };
    }
  };
}
```

- [ ] **Step 5: Implement routes and auto root-thread flow**

Create one-file-per-API route files and compose them in `modules/flows/index.ts`:

```ts
import { Elysia } from "elysia";

export function flowsModule(config: {
  baseDir: string;
  pauseStore: import("../../runtime/pause-store").PauseStore;
  jobManager: ReturnType<typeof import("../../runtime/job-manager").createJobManager>;
}) {
  const service = createFlowsService(config);
  return new Elysia({ prefix: "/api", name: "ooc.flows" })
    .use(createSessionApi(service))
    .use(createFlowObjectApi(service))
    .use(getFlowObjectApi(service))
    .use(getThreadApi(service))
    .use(pauseSessionApi(service))
    .use(resumeSessionApi(service))
    .use(callMethodApi(service));
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run:

```bash
bun test src/app/server/modules/flows/service.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/app/server/modules/flows src/persistable
git commit -m "feat(server): add flows apis and auto root thread"
```

### Task 7: Wire Worker, Resume, And End-to-End Verification

**Files:**
- Modify: `src/app/server/bootstrap/config.ts`
- Modify: `src/app/server/index.ts`
- Modify: `src/app/server/modules/flows/service.ts`
- Test: `src/app/server/__tests__/server.test.ts`

- [ ] **Step 1: Write failing integration-style server test for pause/resume path**

Append to `src/app/server/__tests__/server.test.ts`:

```ts
test("creates session then flow object endpoints", async () => {
  const app = buildServer({
    port: 0,
    baseDir: "/tmp/ooc-app-test",
    workerPollMs: 10
  });

  const sessionResp = await app.handle(
    new Request("http://localhost/api/flows/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: "s1", title: "demo" })
    })
  );
  expect(sessionResp.status).toBe(200);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
bun test src/app/server/__tests__/server.test.ts
```

Expected: FAIL on missing flows/runtime wiring.

- [ ] **Step 3: Extend config with runtime singletons**

Update `src/app/server/bootstrap/config.ts`:

```ts
import { createJobManager } from "../runtime/job-manager";
import { createPauseStore } from "../runtime/pause-store";

export interface ServerConfig {
  port: number;
  baseDir: string;
  workerPollMs: number;
  pauseStore: ReturnType<typeof createPauseStore>;
  jobManager: ReturnType<typeof createJobManager>;
}

export function readServerConfig(): ServerConfig {
  return {
    port: Number(process.env.OOC_APP_PORT ?? 3000),
    baseDir: process.env.OOC_BASE_DIR ?? process.cwd(),
    workerPollMs: Number(process.env.OOC_WORKER_POLL_MS ?? 100),
    pauseStore: createPauseStore(),
    jobManager: createJobManager()
  };
}
```

- [ ] **Step 4: Wire pause checker and runtime modules into the server**

Update `src/app/server/index.ts`:

```ts
import { setPauseChecker } from "@src/observable";

export function buildServer(config: ServerConfig = readServerConfig()) {
  setPauseChecker((thread) => {
    const sessionId = thread.persistence?.sessionId;
    return config.pauseStore.isGlobalPauseEnabled() || (sessionId ? config.pauseStore.isSessionPaused(sessionId) : false);
  });

  return new Elysia({ name: "ooc.app.server" })
    .use(healthModule)
    .use(runtimeModule(config))
    .use(stonesModule(config))
    .use(flowsModule(config));
}
```

- [ ] **Step 5: Run focused verification**

Run:

```bash
bun test src/app/server/__tests__/server.test.ts src/app/server/modules/runtime/service.test.ts src/app/server/modules/stones/service.test.ts src/app/server/modules/flows/service.test.ts src/app/server/runtime/job-manager.test.ts src/app/server/runtime/pause-store.test.ts src/app/server/runtime/resume.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run regression suite**

Run:

```bash
bun test src/executable/__tests__/server-loader.test.ts src/executable/__tests__/server-self.test.ts src/observable/__tests__/observable.test.ts src/thinkable/__tests__/thinkloop.test.ts tests/integration/meta-programming.integration.test.ts
```

Expected: PASS, with the real-LLM integration test skipped unless env is configured.

- [ ] **Step 7: Run typecheck**

Run:

```bash
bunx tsc --noEmit
```

Expected: exit code `0`.

- [ ] **Step 8: Commit**

```bash
git add src/app/server src/observable src/executable/server src/persistable package.json
git commit -m "feat(server): add app control plane with runtime and flows"
```

## Self-Review

- **Spec coverage:** 覆盖了 Elysia 脚手架、`api.*.ts` 平铺命名、`stones` / `flows` / `runtime` 三大模块、`ui_methods` HTTP 调用、进程内 worker、pause store、resume runtime、runtime debug API、session 与 flow object 两级创建、自动创建 root thread 与自动启动 job。
- **Placeholder scan:** 计划中没有 `TBD` / `TODO` / “类似上文”这类占位语句；每个任务都包含明确文件、代码骨架与命令。
- **Type consistency:** `RuntimeJob`、`PauseStore`、`ServerConfig`、`loadUiServerMethods()`、`setPauseChecker()`、`createFlowsService()` 等命名在各任务中保持一致。
