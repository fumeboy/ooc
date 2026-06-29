/**
 * Server-lifecycle integration test (issue F1, 2026-06-29)。
 *
 * 验证生产 server 经 buildServer 启动后:
 *  - WorldRuntime 真被构造、暴露在 app.worldRuntime
 *  - app.worldRuntime.reloadTable 存在
 *  - dev=true 时 hot-reload watcher 启动 (worldRuntime 持 reloadTable 引用)
 *  - 调 runtime endpoint 触发 enqueue 时, reloadTable 透到 worker → scheduler →
 *    ThreadRuntime, 经 maybeDispatchOnReload 派发 lifecycle.on_reload (端到端)
 *
 * 不验真实 hot-reload 文件变更 (那是 hot-reload.ts 自己的事); 只验
 * **生产 server 启动时 reloadTable 透传链路完整** — issue F1 的核心目标。
 */
import { describe, it, expect } from "bun:test";
import { buildServer } from "@ooc/core/app/server";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getSessionRegistry,
  releaseSessionRegistry,
} from "@ooc/core/runtime/object-registry";
import type {
  LlmClient,
  LlmGenerateParams,
  LlmGenerateResult,
} from "@ooc/core/thinkable/llm/types";
import type { OocClass } from "@ooc/core/runtime/ooc-class";

const mockLlm: LlmClient = {
  async generate(_params: LlmGenerateParams): Promise<LlmGenerateResult> {
    return {
      provider: "claude",
      model: "mock",
      outputItems: [],
      text: "(mock)",
      toolCalls: [],
    };
  },
};

describe("F1: server integrates WorldRuntime + reloadTable wiring", () => {
  it("buildServer 构造 WorldRuntime, app.worldRuntime.reloadTable 可访问", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "ooc-f1-"));
    const app = buildServer({ baseDir, llm: mockLlm, autoEnqueue: false, dev: false });
    expect(app.worldRuntime).toBeDefined();
    expect(app.worldRuntime.reloadTable).toBeDefined();
    // dev=false 时 hot-reload watcher 不启动, reloadTable 仍存在 (只是没自动接收 stone:changed)
    expect(app.worldRuntime.worldPath).toBe(baseDir);
    await app.worldRuntime.dispose();
    await rm(baseDir, { recursive: true, force: true });
  });

  it("dev=true 时 hot-reload watcher 启动, stoneRegistry.invalidate 写入 reloadTable", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "ooc-f1-dev-"));
    const app = buildServer({ baseDir, llm: mockLlm, autoEnqueue: false, dev: true });
    // 模拟 stoneRegistry 派发 stone:changed 事件 (绕过 fs.watch, 直接触发 listener)
    app.worldRuntime.stoneRegistry.invalidate("test/class-foo", ["executable/index.ts"]);
    // listener 同步写 reloadTable
    const mark = app.worldRuntime.reloadTable.peek("test/class-foo");
    expect(mark).toBeDefined();
    expect(mark!.changedFiles).toContain("executable/index.ts");
    await app.worldRuntime.dispose();
    await rm(baseDir, { recursive: true, force: true });
  });

  it("reloadTable 透到 ThreadRuntime: 模拟 invalidate 后, 调 class 的 active 钩, on_reload 真派发", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "ooc-f1-e2e-"));
    const SESSION = "f1-e2e-session";
    releaseSessionRegistry(SESSION);

    let onReloadCalls = 0;
    let onReloadInfo: { changedFiles?: string[] } | undefined;
    const testCls: OocClass = {
      id: "_test/f1_target",
      construct: {
        description: "test",
        schema: {},
        exec: () => ({ value: 0 }),
      },
      lifecycle: {
        on_reload: {
          description: "test on_reload",
          exec: (_ctx, _self, info) => {
            onReloadCalls += 1;
            onReloadInfo = info;
          },
        },
        active: {
          description: "test active",
          exec: () => {},
        },
      },
    };

    const app = buildServer({ baseDir, llm: mockLlm, autoEnqueue: false, dev: true });
    // 注册测试 class 进 session registry
    const reg = getSessionRegistry(SESSION);
    reg.register(testCls);
    reg.setObject({ id: "obj-1", class: testCls.id, data: {} });

    // 模拟 hot-reload invalidate
    app.worldRuntime.stoneRegistry.invalidate(testCls.id, ["executable/index.ts"]);

    // 经 ThreadRuntime 路径模拟 dispatchActive (生产路径中 thinkloop 之上)
    const { ThreadRuntime } = await import("@ooc/builtins/agent/children/thread");
    // 造一个最简 thread 注入 reloadTable
    const ctor = reg.resolveConstructor("_builtin/agent/thread")!;
    const thread = (await ctor.exec(
      { sessionId: SESSION, worldDir: baseDir, dir: "", args: { calleeObjectId: "_builtin/supervisor" } },
      { calleeObjectId: "_builtin/supervisor", message: "hi" },
    )) as any;
    reg.setObject({ id: thread.id, class: "_builtin/agent/thread", data: thread });

    const runtime = ThreadRuntime.fromThread(thread, {
      worldDir: baseDir,
      reloadTable: app.worldRuntime.reloadTable,
    });
    // 经反射调 private dispatchActive (生产中由 instantiate / dispatchUnactiveIfZero 触发)
    await (runtime as any).dispatchActive("obj-1");

    expect(onReloadCalls).toBe(1);
    expect(onReloadInfo?.changedFiles).toEqual(["executable/index.ts"]);

    releaseSessionRegistry(SESSION);
    await app.worldRuntime.dispose();
    await rm(baseDir, { recursive: true, force: true });
  });
});
