/**
 * Route audit e2e — 拦截 "代码 OK 但真 HTTP server 404" 类假阳性 bug.
 *
 * 背景:
 *   Round 5 体验官 (docs/2026-05-25-round-5-experience-report.md C-1/C-2) 报告
 *   `POST .../permission` 与 `GET .../debug/loops` 在真 HTTP server 上 404,
 *   但 `app.handle(new Request(...))` 单测全部 PASS——典型的 "in-process e2e
 *   能过, 真 HTTP server 不过" 假阳性. 本 audit 故意走真子进程 + 真端口, 把
 *   frontend `web/src/transport/endpoints.ts` 里所有路径形态过一遍, 任何一条
 *   返回 404 / Elysia "route not found" 即视为 regression.
 *
 * 设计要点:
 *   - 选项 A (真 HTTP): 用 `bun packages/@ooc/core/app/server/index.ts --world <tmp> --port <free>`
 *     起真子进程, 而不是 `app.handle()`. 这是直接拦截 Elysia plugin .use() 顺序 /
 *     name 冲突 / router 规则冲突的唯一方式.
 *   - 只关心 routing 是否注册: 404 = fail, 其它状态(200/400/409/422/500)= pass.
 *     用假参数填 path; 不期望业务 happy path 通过.
 *   - 错误打印: route + method + status + body 前 200 字, 不 silent-swallow.
 *
 * 进程卫生 (engineering.harness.doc.ts:patches.test_session_hygiene):
 *   - 独立 mkdtempSync world, afterAll rm -rf
 *   - subprocess kill('SIGTERM') + wait, 不留 zombie
 *   - session id 用 `_test_route_audit_<ts>` 前缀
 *
 * 代理处理:
 *   - 测试运行环境可能有 http_proxy=Clash:7890. fetch 默认会走代理 → 直接 502.
 *     用 `Bun.fetch` 直连; 如未来切回 globalThis.fetch, 需 explicit `dispatcher`
 *     或设 `NO_PROXY=*`.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SESSION_ID = `_test_route_audit_${Date.now()}`;
const OBJECT_ID = "audit-obj";
const THREAD_ID = "audit-thread";

interface RouteCase {
  /** 人类可读的标识 — 失败诊断里打印. */
  name: string;
  method: "GET" | "POST" | "PUT" | "DELETE";
  /** path with placeholder values 已替换 (server-relative, e.g. "/api/health"). */
  path: string;
  /** POST body (json). */
  body?: unknown;
  /** 期望 status 不属于这一组 (默认 [404] — 任何非 404 即视为 route 已注册). */
  notExpected?: number[];
}

/**
 * Audit 路由清单 — 镜像 `web/src/transport/endpoints.ts` 实际调用面, 加上一些
 * 关键 backend-only 端点. 任意一条 404 即视为 regression.
 *
 * 注: 列表覆盖率优先于严密性. 新增 endpoint 时务必在此添加一条形态相同的 audit
 * 用例 (即使只是占位 — 用假 id 也行).
 */
function buildRouteCases(): RouteCase[] {
  const sid = SESSION_ID;
  const oid = OBJECT_ID;
  const tid = THREAD_ID;
  return [
    // 健康检查 / 全局状态
    { name: "health", method: "GET", path: "/api/health" },
    { name: "runtime.global-pause.status", method: "GET", path: "/api/runtime/global-pause/status" },
    { name: "runtime.debug.status", method: "GET", path: "/api/runtime/debug/status" },
    { name: "runtime.llm-config", method: "GET", path: "/api/runtime/llm-config" },

    // Flows / sessions
    { name: "flows.list", method: "GET", path: "/api/flows" },
    {
      name: "flows.create",
      method: "POST",
      path: "/api/flows",
      body: { sessionId: sid },
    },
    { name: "flows.threads.list", method: "GET", path: `/api/flows/${sid}/threads` },

    // Stones / pools (knowledge endpoint — pool 顶层没有 list endpoint, 走 knowledge prefix)
    { name: "stones.list", method: "GET", path: "/api/stones" },
    {
      name: "pools.knowledge.directories",
      method: "POST",
      path: `/api/pools/${OBJECT_ID}/knowledge/directories`,
      body: { path: "ignored" },
    },

    // Tree / file
    { name: "tree", method: "GET", path: "/api/tree?scope=world&path=" },
    { name: "tree.file", method: "GET", path: "/api/tree/file?path=nonexistent.md" },

    // Thread-scoped — C-1 + C-2 直接受体, 必含
    {
      name: "C-2 runtime.debug.latest",
      method: "GET",
      path: `/api/runtime/flows/${sid}/${oid}/threads/${tid}/debug`,
    },
    {
      name: "C-2 runtime.debug.loops.list",
      method: "GET",
      path: `/api/runtime/flows/${sid}/${oid}/threads/${tid}/debug/loops`,
    },
    {
      name: "C-2 runtime.debug.loops.single",
      method: "GET",
      path: `/api/runtime/flows/${sid}/${oid}/threads/${tid}/debug/loops/1`,
    },
    {
      name: "C-1 runtime.permission",
      method: "POST",
      path: `/api/runtime/flows/${sid}/${oid}/threads/${tid}/permission`,
      body: { action: "approve" },
    },
  ];
}

interface BackendHandle {
  process: ReturnType<typeof Bun.spawn>;
  port: number;
  baseDir: string;
}

async function pickFreePort(): Promise<number> {
  // 0 让 bun 选个空闲端口, 然后立刻关掉, 拿到端口号. 极小概率与下一次 bind 冲突;
  // 实践里 OK, 失败重试 1 次.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const server = Bun.serve({ port: 0, fetch: () => new Response("ok") });
    const port = server.port;
    server.stop(true);
    if (typeof port === "number" && port > 0) return port;
  }
  throw new Error("could not allocate a free port");
}

async function waitForReady(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const url = `http://127.0.0.1:${port}/api/health`;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.status === 200) return;
      lastErr = new Error(`health returned ${res.status}`);
    } catch (e) {
      lastErr = e;
    }
    await Bun.sleep(150);
  }
  throw new Error(
    `backend on port ${port} did not become ready within ${timeoutMs}ms: ${
      lastErr instanceof Error ? lastErr.message : String(lastErr)
    }`,
  );
}

async function startBackend(): Promise<BackendHandle> {
  const baseDir = mkdtempSync(join(tmpdir(), "_test_route_audit_world_"));
  const port = await pickFreePort();
  // 显式 NO_PROXY: 跨平台让 fetch 不走 Clash:7890 (体验官报告 § 环境校验).
  // 注意: subprocess 也继承一份, 但 backend 本身不发外网请求, 主要保护 client fetch.
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    NO_PROXY: "*",
    no_proxy: "*",
  };
  // 不带 ANTHROPIC_AUTH_TOKEN: audit 不触发 thinkloop, 不需要真 LLM.
  // 但保留 PATH / HOME 等 (...process.env).
  const proc = Bun.spawn(
    [
      "bun",
      "packages/@ooc/core/app/server/index.ts",
      "--world",
      baseDir,
      "--port",
      String(port),
    ],
    {
      cwd: process.cwd(),
      env,
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  try {
    await waitForReady(port, 20_000);
  } catch (e) {
    // 启动失败: 打印 stderr 给诊断, 然后清理
    let stderrText = "";
    try {
      stderrText = await new Response(proc.stderr).text();
    } catch {}
    proc.kill("SIGTERM");
    try {
      await proc.exited;
    } catch {}
    rmSync(baseDir, { recursive: true, force: true });
    throw new Error(
      `backend startup failed: ${
        e instanceof Error ? e.message : String(e)
      }\nstderr:\n${stderrText.slice(0, 2000)}`,
    );
  }
  return { process: proc, port, baseDir };
}

async function stopBackend(handle: BackendHandle): Promise<void> {
  handle.process.kill("SIGTERM");
  // 兜底: 1s 还没退就 SIGKILL
  const exited = handle.process.exited;
  const timeout = new Promise<"timeout">((resolve) =>
    setTimeout(() => resolve("timeout"), 1_000),
  );
  const result = await Promise.race([exited, timeout]);
  if (result === "timeout") {
    try {
      handle.process.kill("SIGKILL");
    } catch {}
    try {
      await handle.process.exited;
    } catch {}
  }
  rmSync(handle.baseDir, { recursive: true, force: true });
}

let backend: BackendHandle | undefined;

beforeAll(async () => {
  backend = await startBackend();
});

afterAll(async () => {
  if (backend) {
    await stopBackend(backend);
    backend = undefined;
  }
});

describe("backend route audit (真 HTTP server)", () => {
  test("所有 frontend transport 端点必须在真 HTTP server 上命中 (非 404)", async () => {
    if (!backend) throw new Error("backend not started");
    const cases = buildRouteCases();
    const failures: Array<{ name: string; method: string; path: string; status: number; bodyExcerpt: string }> = [];

    for (const c of cases) {
      const url = `http://127.0.0.1:${backend.port}${c.path}`;
      const init: RequestInit = { method: c.method };
      if (c.body !== undefined) {
        init.body = JSON.stringify(c.body);
        init.headers = { "Content-Type": "application/json" };
      }
      let status = -1;
      let bodyExcerpt = "";
      try {
        const res = await fetch(url, init);
        status = res.status;
        const text = await res.text();
        bodyExcerpt = text.slice(0, 200);
      } catch (e) {
        bodyExcerpt = `fetch threw: ${e instanceof Error ? e.message : String(e)}`;
      }

      // 关键判定: 仅 "route not found: <METHOD> <PATH>" 文案 == route 未注册 (Elysia 默认
      // NotFoundError, 详见 packages/@ooc/core/app/server/index.ts:normalizeErrorToJson elysiaCode==="NOT_FOUND"
      // 分支). 业务层 throw 的 AppServerError({code:"NOT_FOUND"}) 走 ERROR_HTTP_STATUS 也是
      // 404, 但 message 是业务文案 (如 "thread 'xxx' not found", "debug file 'xxx' not found").
      // audit 不验业务可达性, 只验 routing 命中.
      const isRouteMissing =
        status === 404 && /route not found:/i.test(bodyExcerpt);
      if (isRouteMissing) {
        failures.push({
          name: c.name,
          method: c.method,
          path: c.path,
          status,
          bodyExcerpt,
        });
      }
    }

    if (failures.length > 0) {
      // silent-swallow ban: 打印完整列表, 测试报告里能直接看到 URL + body 前 200 字
      const lines = failures.map(
        (f) =>
          `  - [${f.method}] ${f.path} -> ${f.status}\n      body: ${f.bodyExcerpt}`,
      );
      // 用 expect 的失败信息 hook
      expect(
        failures,
        `route audit found ${failures.length} unregistered route(s):\n${lines.join("\n")}`,
      ).toEqual([]);
    }
  }, 30_000);
});
