/**
 * Stone client parity e2e — 验证 OOC dogfood "Object 自带 UI" 的承诺真正落地。
 *
 * 背景:
 *   Round 5 体验官报告 M-4: `/api/objects/stone/supervisor/client-source-url`
 *   一直返回 404, 因为没有任何 stone 真的写过 `client/index.tsx`. agent-native
 *   UI parity (meta/object.doc.ts:visible.children.stone_client) 处于 design-only.
 *
 *   Round 6 Batch B 给 supervisor stone 写了第一份真 client tsx, 把 dogfood 样例
 *   立起来. 本 e2e 拦截以下回归:
 *     - 真 HTTP server 上 client-source-url 必须返回 200 + 路径
 *     - 路径必须可通过 `/@fs/` 风格 absPath 读到 tsx 源码 (用 fs 直接读, 不依赖 vite)
 *     - feedback-tracker (尚未写 client) 仍 404 — 作为"下一轮要补"的提醒
 *
 * 设计要点:
 *   - **不**新建临时 world: 走真实仓库的 `.ooc-world/`. 因为本测试本质上是验证
 *     "项目自己 ship 的 stone 是否带 UI", 不是验证 endpoint 通用行为. 用 mkdtempSync
 *     反而会失去测试意义.
 *   - 真 Bun.spawn 启 backend, 与 route-audit 同款进程卫生.
 *   - SIGTERM + 1s 超时兜 SIGKILL; afterAll 必 kill, 不留 zombie.
 *
 * 进程卫生 (engineering.harness.doc.ts:patches.test_session_hygiene):
 *   - session id 用 `_test_visible_<ts>` 前缀 (虽然本测试不创建 session, 维持约定).
 *   - 不污染 .ooc-world/flows/.
 *
 * 代理处理: 与 route-audit 同款 NO_PROXY="*".
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

const _SESSION_PREFIX = `_test_visible_${Date.now()}`;
void _SESSION_PREFIX; // 维持命名约定, 即使本测试未创建 session

interface BackendHandle {
  process: ReturnType<typeof Bun.spawn>;
  port: number;
}

async function pickFreePort(): Promise<number> {
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
  const port = await pickFreePort();
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    NO_PROXY: "*",
    no_proxy: "*",
  };
  const proc = Bun.spawn(
    [
      "bun",
      "src/app/server/index.ts",
      "--world",
      "./.ooc-world",
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
    let stderrText = "";
    try {
      stderrText = await new Response(proc.stderr).text();
    } catch {}
    proc.kill("SIGTERM");
    try {
      await proc.exited;
    } catch {}
    throw new Error(
      `backend startup failed: ${
        e instanceof Error ? e.message : String(e)
      }\nstderr:\n${stderrText.slice(0, 2000)}`,
    );
  }
  return { process: proc, port };
}

async function stopBackend(handle: BackendHandle): Promise<void> {
  handle.process.kill("SIGTERM");
  const exited = handle.process.exited;
  const timeout = new Promise<"timeout">((res) =>
    setTimeout(() => res("timeout"), 1_000),
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

describe("stone client parity (agent-native UI dogfood)", () => {
  test("supervisor stone 自带 client/index.tsx — endpoint 返回 200 + 真 tsx 源码", async () => {
    if (!backend) throw new Error("backend not started");

    // 1) client-source-url endpoint 必须 200
    const url = `http://127.0.0.1:${backend.port}/api/objects/stone/supervisor/client-source-url`;
    const res = await fetch(url);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { absPath?: string; fsUrl?: string };
    expect(typeof body.absPath).toBe("string");
    expect(typeof body.fsUrl).toBe("string");
    expect(body.absPath!).toMatch(/supervisor[/\\]client[/\\]index\.tsx$/);

    // === visible 渲染回归 gate (Round 17) ===
    // backend 以相对 `--world ./.ooc-world` 启动 (见 startBackend), config.baseDir
    // 必须已归一为绝对路径, 于是 fsUrl = `/@fs` + 绝对 absPath = `/@fs/...`。
    // 旧 bug: baseDir 取相对原值 → fsUrl = `/@fs.ooc-world/...`, vite `/@fs` 协议
    // 要求绝对路径, 浏览器 dynamic import 必失败, client page 渲染不出来。
    expect(body.absPath!.startsWith("/")).toBe(true); // absPath 名副其实: 真绝对
    expect(body.fsUrl!.startsWith("/@fs/")).toBe(true); // 绝对 /@fs/, 不是相对 /@fs.
    expect(body.fsUrl!.startsWith("/@fs.")).toBe(false); // 显式拦旧坏形态

    // 2) absPath 必须真实存在且可读 (用 fs 直接读, 不走 vite)
    //    baseDir 已归一为绝对, absPath 直接可用; resolve 对绝对路径幂等。
    const absPath = resolve(body.absPath!);
    const st = await stat(absPath);
    expect(st.isFile()).toBe(true);

    const tsxContent = await readFile(absPath, "utf8");
    // 3) 内容是合法 tsx — 至少要有 default export 和 React import
    expect(tsxContent).toContain("export default");
    expect(tsxContent).toMatch(/import .* from ['"]react['"]/);
    // 4) 形态校验: 是 supervisor 的 client, 不是 unrelated 文件被错误指向
    expect(tsxContent).toMatch(/supervisor/i);
  }, 30_000);

  test("feedback-tracker 仍未写 client — 当前预期 404, 留作下一轮补充提醒", async () => {
    if (!backend) throw new Error("backend not started");
    const url = `http://127.0.0.1:${backend.port}/api/objects/stone/feedback-tracker/client-source-url`;
    const res = await fetch(url);
    // 预期 404 — agent-native parity 还差一个样例.
    //   当未来给 feedback-tracker 写完 client/index.tsx, 这个断言会失败,
    //   提醒维护者把它从 "remaining" 列表里挪出去.
    expect(res.status).toBe(404);
    const text = await res.text();
    expect(text).toMatch(/client source not found.*feedback-tracker/);
  }, 30_000);
});
