/**
 * Frontend e2e fixture — Object Client 渲染专用。
 *
 * 与 _fixture.ts 区别：
 * - 不依赖真 LLM（client 渲染 + callMethod 不走 LLM 路径）
 * - 给 Vite 传 OOC_WORLD_DIR，确保 `__OOC_WORLD_ROOT__` define 命中临时世界目录
 * - 仅靠 RUN_FRONTEND_E2E=1 gating；缺则 skip
 *
 * 用法：
 *
 *   test("...", async ({ page, world }) => {
 *     world.writeStoneClient("demo", "...tsx 源码...");
 *     await world.startStack();
 *     await page.goto(world.previewUrl({ scope: "stone", objectId: "demo" }));
 *     ...
 *   });
 */

import { test as base, expect, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { nestedObjectPath } from "@ooc/core/persistable";

export const shouldRunFrontendClientE2E = process.env.RUN_FRONTEND_E2E === "1";

function pickPort(): number {
  return 30_000 + Math.floor(Math.random() * 30_000);
}

/**
 * 等待 TCP 端口可连。
 *
 * 不走 fetch —— 开发机若设 http_proxy / clash，fetch 默认把 localhost 也代理掉
 * 而返回 502。直接 net.connect 测端口，绕开代理。
 */
async function waitForPort(host: string, port: number, timeoutMs = 30_000, intervalMs = 200): Promise<void> {
  const { connect } = await import("node:net");
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await new Promise<boolean>((resolve) => {
      const sock = connect({ host, port }, () => {
        sock.end();
        resolve(true);
      });
      sock.on("error", () => resolve(false));
      sock.setTimeout(intervalMs, () => {
        sock.destroy();
        resolve(false);
      });
    });
    if (ok) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`waitForPort timed out for ${host}:${port}`);
}

/** 清理 spawn 子进程的代理 env —— 让 localhost API 调用不走 clash 等 7890 代理。 */
function envWithoutProxy(extra: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const cleaned = { ...process.env, ...extra };
  for (const key of [
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "http_proxy",
    "https_proxy",
    "ALL_PROXY",
    "all_proxy",
  ]) {
    delete cleaned[key];
  }
  // 兜底：把 localhost 永远列为 no_proxy
  cleaned.NO_PROXY = "localhost,127.0.0.1";
  cleaned.no_proxy = "localhost,127.0.0.1";
  return cleaned;
}

function killGracefully(proc: ChildProcess): Promise<void> {
  return new Promise((resolveKill) => {
    if (proc.exitCode !== null || proc.signalCode !== null) {
      resolveKill();
      return;
    }
    proc.once("exit", () => resolveKill());
    proc.kill("SIGTERM");
    setTimeout(() => {
      if (proc.exitCode === null) proc.kill("SIGKILL");
    }, 3_000);
  });
}

export interface PreviewQuery {
  scope: "stone" | "flow";
  objectId: string;
  sessionId?: string;
  page?: string;
}

export interface WorldFixture {
  baseDir: string;
  /** 给当前 baseDir 下的 stone 写 client/index.tsx；自动 mkdir。 */
  writeStoneClient(objectId: string, code: string): void;
  /** 给当前 baseDir 下的 flow object 写 client/pages/{page}.tsx；自动 mkdir。 */
  writeFlowClientPage(args: {
    sessionId: string;
    objectId: string;
    page: string;
    code: string;
  }): void;
  /** 给 stone 写根 index.ts；Class.visibleServer.methods 里的方法通过 callMethod（HTTP）调到。 */
  writeStoneServer(objectId: string, code: string): void;
  /** 给 stone 写任意相对文件（如 self.md）；自动 mkdir。A1 用来 seed 初始 self.md 内容。 */
  writeStoneFile(objectId: string, relPath: string, content: string): void;
  /** 在 stones 目录下创建一个空 stone（.stone.json + 必要骨架）。 */
  createStone(objectId: string): void;
  /**
   * A2 flow scope：在 flow session 下建一个标准 flow object（写 .session.json + .flow.json）。
   * 可选 `class` 指向 object registry 已注册的 class（如 `_builtin/agent/todo`），让该 object
   * 继承 visibleServer 方法（callMethod 经 flows /call_method dispatch 调到）。
   * 不经 thread / LLM —— 纯 HTTP/文件直建。
   */
  createFlowObject(sessionId: string, objectId: string, className?: string): void;
  /** spawn backend + Vite；test.use 之后调一次。 */
  startStack(): Promise<void>;
  /** 拼 object-client.html?... URL。 */
  previewUrl(query: PreviewQuery): string;
  /** Vite web 根 URL（A1 走完整 shell：`${webUrl()}/files/<path>`）。startStack() 后可用。 */
  webUrl(): string;
  /** backend 根 URL（A1/A2 经 HTTP 直读核验：`${backendUrl()}/api/...`）。startStack() 后可用。 */
  backendUrl(): string;
}

interface InternalState {
  backend?: { proc: ChildProcess; port: number; baseURL: string };
  web?: { proc: ChildProcess; port: number; url: string };
}

export const test = base.extend<{ world: WorldFixture }>({
  world: async ({}, use) => {
    if (!shouldRunFrontendClientE2E) {
      test.skip(true, "RUN_FRONTEND_E2E=1 未设置，跳过 client e2e");
      return;
    }

    const baseDir = mkdtempSync(join(tmpdir(), "ooc-e2e-client-"));
    mkdirSync(join(baseDir, "stones"), { recursive: true });
    mkdirSync(join(baseDir, "flows"), { recursive: true });
    const state: InternalState = {};

    // stone-repo worktree 模型（CLAUDE.md 约束 1/2）：backend 启动期 `ensureStoneRepo`
    // 把 `stones/main` 重置成 git worktree（仅 canonical commit 内容），任何**先于** boot
    // 直写到 `stones/main/objects/...` 的未提交文件都会被这次 checkout 抹掉。
    // 因此 createStone/writeStoneClient/writeStoneServer 只入队闭包，等 startStack() boot
    // 完 backend（端口可连=ensureStoneRepo 已完成）后再真写盘。
    // flows/ 不在 stone repo 内，不受影响，但同样延迟以保持单一写盘时机。
    const pendingSeeds: Array<() => void | Promise<void>> = [];

    const fixture: WorldFixture = {
      baseDir,
      createStone(objectId) {
        pendingSeeds.push(() => {
          const dir = join(baseDir, "stones", "main", "objects", ...nestedObjectPath(objectId));
          mkdirSync(dir, { recursive: true });
          mkdirSync(join(dir, "knowledge"), { recursive: true });
          mkdirSync(join(dir, "client"), { recursive: true });
          mkdirSync(join(dir, "server"), { recursive: true });
          // stone-registry（packages/@ooc/core/runtime/stone-registry.ts:92）把"带
          // package.json#ooc 的目录"识别为 stone；/api/stones 据此 list，StoneFallback
          // 的 useStoneExists 又据 list 判存在。旧 .stone.json marker 已退役——必须写
          // package.json，否则 seeded stone 不被 list → fallback 报 "Stone not found"。
          writeFileSync(
            join(dir, "package.json"),
            JSON.stringify(
              {
                name: `@ooc-obj/${objectId}`,
                version: "0.0.0",
                private: true,
                type: "module",
                ooc: { objectId, kind: "object" },
              },
              null,
              2,
            ),
            "utf8",
          );
        });
      },
      writeStoneClient(objectId, code) {
        pendingSeeds.push(() => {
          const clientDir = join(baseDir, "stones", "main", "objects", ...nestedObjectPath(objectId), "client");
          mkdirSync(clientDir, { recursive: true });
          writeFileSync(join(clientDir, "index.tsx"), code, "utf8");
        });
      },
      writeFlowClientPage({ sessionId, objectId, page, code }) {
        pendingSeeds.push(() => {
          const dir = join(baseDir, "flows", sessionId, "objects", ...nestedObjectPath(objectId), "client", "pages");
          mkdirSync(dir, { recursive: true });
          writeFileSync(join(dir, `${page}.tsx`), code, "utf8");
        });
      },
      writeStoneServer(objectId, code) {
        pendingSeeds.push(() => {
          // 根 index.ts 的 `export const Class`（visible/server 方法在 Class.visibleServer）。
          const dir = join(baseDir, "stones", "main", "objects", ...nestedObjectPath(objectId));
          mkdirSync(dir, { recursive: true });
          writeFileSync(join(dir, "index.ts"), code, "utf8");
        });
      },
      writeStoneFile(objectId, relPath, content) {
        pendingSeeds.push(() => {
          const dir = join(baseDir, "stones", "main", "objects", ...nestedObjectPath(objectId));
          const abs = join(dir, relPath);
          mkdirSync(join(abs, ".."), { recursive: true });
          writeFileSync(abs, content, "utf8");
        });
      },
      createFlowObject(sessionId, objectId, className) {
        pendingSeeds.push(() => {
          // 标准 flow object：直写 .session.json（session 元数据）+ .flow.json（带 class）。
          //
          // 不用 persistable.createFlowObject（它对 builtinRegistry 做 class 存在性校验）——
          // 该 registry 仅在 buildServer 进程内被实例化填充；本 fixture 跑在 Playwright 测试
          // 进程里，registry 是空的，校验会误判 class 不存在。直写文件即可：负责解析 class 的是
          // backend 进程（call_method 时按其自身已填充的 registry 沿继承链找 visibleServer）。
          const sessDir = join(baseDir, "flows", sessionId);
          mkdirSync(sessDir, { recursive: true });
          writeFileSync(
            join(sessDir, ".session.json"),
            JSON.stringify({ type: "flow-session", sessionId, title: sessionId }, null, 2),
            "utf8",
          );
          const objDir = join(sessDir, "objects", ...nestedObjectPath(objectId));
          mkdirSync(objDir, { recursive: true });
          writeFileSync(
            join(objDir, ".flow.json"),
            JSON.stringify(
              {
                type: "flow-object",
                sessionId,
                objectId,
                ...(className !== undefined ? { class: className } : {}),
              },
              null,
              2,
            ),
            "utf8",
          );
        });
      },
      async startStack() {
        const repoRoot = resolve(process.cwd());
        const backendPort = pickPort();
        const backend = spawn(
          "bun",
          [join(repoRoot, "packages/@ooc/core/app/server/index.ts"), "--world", baseDir],
          {
            cwd: repoRoot,
            env: envWithoutProxy({
              OOC_APP_PORT: String(backendPort),
              OOC_WORKER_ENABLED: "0", // 不需要 LLM worker
            }),
            stdio: ["ignore", "pipe", "pipe"],
          },
        );
        backend.stdout?.on("data", (c) => process.stderr.write(`[backend] ${c}`));
        backend.stderr?.on("data", (c) => process.stderr.write(`[backend!] ${c}`));
        const baseURL = `http://127.0.0.1:${backendPort}`;
        await waitForPort("127.0.0.1", backendPort, 30_000);
        state.backend = { proc: backend, port: backendPort, baseURL };

        // backend boot 完成 → ensureStoneRepo 已建好 worktree；此刻才真写 seed 文件，
        // 避免被启动期 checkout 抹掉。vite 随后启动，OOC_WORLD_DIR 指向同一 baseDir，
        // /@fs 能读到这些文件。
        for (const seed of pendingSeeds) await seed();

        const webPort = pickPort();
        const web = spawn(
          "bun",
          ["run", "dev", "--", "--port", String(webPort), "--strictPort", "--host", "127.0.0.1"],
          {
            cwd: join(repoRoot, "packages/@ooc/web"),
            env: envWithoutProxy({
              OOC_API_TARGET: baseURL,
              OOC_WORLD_DIR: baseDir,
            }),
            stdio: ["ignore", "pipe", "pipe"],
          },
        );
        web.stdout?.on("data", (c) => process.stderr.write(`[web] ${c}`));
        web.stderr?.on("data", (c) => process.stderr.write(`[web!] ${c}`));
        const webURL = `http://127.0.0.1:${webPort}`;
        await waitForPort("127.0.0.1", webPort, 30_000);
        state.web = { proc: web, port: webPort, url: webURL };
      },
      webUrl() {
        if (!state.web) throw new Error("startStack() before webUrl()");
        return state.web.url;
      },
      backendUrl() {
        if (!state.backend) throw new Error("startStack() before backendUrl()");
        return state.backend.baseURL;
      },
      previewUrl(query) {
        if (!state.web) throw new Error("startStack() before previewUrl()");
        const params = new URLSearchParams();
        params.set("scope", query.scope);
        params.set("objectId", query.objectId);
        if (query.sessionId) params.set("sessionId", query.sessionId);
        if (query.page) params.set("page", query.page);
        return `${state.web.url}/object-client.html?${params.toString()}`;
      },
    };

    await use(fixture);

    if (state.web) await killGracefully(state.web.proc);
    if (state.backend) await killGracefully(state.backend.proc);
    rmSync(baseDir, { recursive: true, force: true });
  },
});

export { expect };

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
