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
  /** 给 stone 写 executable/index.ts；window.methods 里 for_ui_access 方法通过 callMethod 调到。 */
  writeStoneServer(objectId: string, code: string): void;
  /** 在 stones 目录下创建一个空 stone（.stone.json + 必要骨架）。 */
  createStone(objectId: string): void;
  /** spawn backend + Vite；test.use 之后调一次。 */
  startStack(): Promise<void>;
  /** 拼 object-client.html?... URL。 */
  previewUrl(query: PreviewQuery): string;
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

    const fixture: WorldFixture = {
      baseDir,
      createStone(objectId) {
        const dir = join(baseDir, "stones", "main", "objects", ...nestedObjectPath(objectId));
        mkdirSync(dir, { recursive: true });
        mkdirSync(join(dir, "knowledge"), { recursive: true });
        mkdirSync(join(dir, "client"), { recursive: true });
        mkdirSync(join(dir, "server"), { recursive: true });
        writeFileSync(
          join(dir, ".stone.json"),
          JSON.stringify({ type: "stone", objectId }, null, 2),
          "utf8",
        );
      },
      writeStoneClient(objectId, code) {
        const file = join(baseDir, "stones", "main", "objects", ...nestedObjectPath(objectId), "client", "index.tsx");
        mkdirSync(join(baseDir, "stones", "main", "objects", ...nestedObjectPath(objectId), "client"), { recursive: true });
        writeFileSync(file, code, "utf8");
      },
      writeFlowClientPage({ sessionId, objectId, page, code }) {
        const dir = join(baseDir, "flows", sessionId, "objects", ...nestedObjectPath(objectId), "client", "pages");
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, `${page}.tsx`), code, "utf8");
      },
      writeStoneServer(objectId, code) {
        const dir = join(baseDir, "stones", "main", "objects", ...nestedObjectPath(objectId), "server");
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, "index.ts"), code, "utf8");
      },
      async startStack() {
        const repoRoot = resolve(process.cwd());
        const backendPort = pickPort();
        const backend = spawn(
          "bun",
          [join(repoRoot, "src/app/server/index.ts"), "--world", baseDir],
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

        const webPort = pickPort();
        const web = spawn(
          "bun",
          ["run", "dev", "--", "--port", String(webPort), "--strictPort", "--host", "127.0.0.1"],
          {
            cwd: join(repoRoot, "web"),
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
