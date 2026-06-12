/**
 * 组合机制（agent 持有 tool-object 成员）—— 确定性集成测试。
 *
 * 证明端到端：supervisor 类声明 filesystem 成员 → injectMemberWindowsIfObjectThread 注入
 * filesystem member 窗 → exec(filesystem, grep) 经成员方法造出 search 对象。零 LLM。
 */
import { test, expect } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureStoneRepo } from "@ooc/core/persistable";
import { builtinRegistry } from "@ooc/core/runtime/object-registry.js";
// named import 触发 windows/index.ts 模块求值 → 加载全部 builtin（含 filesystem 注册）。
import { injectMemberWindowsIfObjectThread, WindowManager } from "@ooc/core/executable/windows";

function mkSupervisorThread(baseDir: string): any {
  return {
    id: "root",
    status: "running",
    persistence: { baseDir, sessionId: "_test_comp", objectId: "supervisor", threadId: "root" },
    contextWindows: [],
  };
}

test("组合：supervisor 类声明 filesystem 成员 → injectMember 注入 filesystem member 窗（非持久化）", async () => {
  const baseDir = await mkdtemp(join(tmpdir(), "ooc-comp-"));
  try {
    await ensureStoneRepo({ baseDir });
    const { instantiateBuiltinClassObjects } = await import("@ooc/core/app/server/bootstrap/instantiate-classes");
    await instantiateBuiltinClassObjects({ baseDir });

    const thread = mkSupervisorThread(baseDir);
    await injectMemberWindowsIfObjectThread(thread);

    const fsWin = thread.contextWindows.find((w: any) => w.class === "filesystem");
    expect(fsWin).toBeDefined();
    expect(fsWin.isMemberWindow).toBe(true);
    expect(fsWin.id).toBe("filesystem");
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test("组合机制命门：exec(filesystem, grep) 经成员方法造出 search 对象", async () => {
  const baseDir = await mkdtemp(join(tmpdir(), "ooc-comp-"));
  try {
    await ensureStoneRepo({ baseDir });
    const thread = mkSupervisorThread(baseDir);
    thread.contextWindows = [
      { id: "filesystem", class: "filesystem", parentWindowId: "root", title: "member: filesystem",
        status: "open", createdAt: Date.now(), isMemberWindow: true },
    ];

    const mgr = WindowManager.fromThread(thread, builtinRegistry);
    await mgr.openMethodExec({
      thread, parentWindowId: "filesystem", method: "grep",
      title: "grep", args: { pattern: "version", path: baseDir },
    });

    const search = mgr.list().find((w) => w.class === "search");
    expect(search).toBeDefined();
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});
