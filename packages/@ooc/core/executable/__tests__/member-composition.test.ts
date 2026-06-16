/**
 * 组合机制（agent 持有 tool-object 成员）—— 确定性集成测试。
 *
 * 证明端到端：supervisor 类声明 filesystem 成员 → injectMemberWindowsIfObjectThread 注入
 * filesystem member 窗 → exec(filesystem, grep) 经成员方法造出 search 对象（含真实命中）→
 * member 窗非持久化（不入 thread-context.json，readThread 重注入）。零 LLM。
 */
import { test, expect } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureStoneRepo } from "@ooc/core/persistable";
import { writeThread, readThread } from "@ooc/builtins/agent/thread/persistable/thread-json";
import { builtinRegistry } from "@ooc/core/runtime/object-registry.js";
// named import 触发 windows/index.ts 模块求值 → 加载全部 builtin（含 filesystem 注册）。
import { injectMemberWindowsIfObjectThread } from "@ooc/core/thinkable/context/init.js";
import { WindowManager } from "@ooc/core/executable/manager.js";

function mkSupervisorThread(baseDir: string): any {
  return {
    id: "root",
    status: "running",
    events: [],
    persistence: { baseDir, sessionId: "_test_comp", objectId: "supervisor", threadId: "root" },
    contextWindows: [],
  };
}

const FS_WIN = {
  id: "filesystem", class: "filesystem", parentWindowId: "root", title: "member: filesystem",
  status: "open", createdAt: 0, isMemberWindow: true,
};

test("组合：supervisor 类声明 filesystem 成员 → injectMember 注入 filesystem member 窗（非持久化标记）", async () => {
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

test("组合机制命门：exec(filesystem, grep) 经成员方法造出 search 对象（含真实命中）", async () => {
  const baseDir = await mkdtemp(join(tmpdir(), "ooc-comp-"));
  try {
    await ensureStoneRepo({ baseDir });
    // 写一个已知内容的探针文件，保证 grep 有真实命中（强化：不止「窗存在」，还要命中>0）。
    await writeFile(join(baseDir, "probe.txt"), "OOC_MARKER alpha\nbeta OOC_MARKER\n", "utf8");

    const thread = mkSupervisorThread(baseDir);
    thread.contextWindows = [{ ...FS_WIN, createdAt: Date.now() }];

    const mgr = WindowManager.fromThread(thread, builtinRegistry);
    await mgr.openMethodExec({
      thread, parentWindowId: "filesystem", method: "grep",
      title: "grep", args: { pattern: "OOC_MARKER", path: baseDir },
    });

    const search = mgr.list().find((w) => w.class === "search") as any;
    expect(search).toBeDefined();
    expect(search.kind).toBe("grep");
    expect(search.matches.length).toBeGreaterThan(0); // 真实命中，证明是经 filesystem 成员真跑了 grep
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test("非持久化往返：member 窗不入 thread-context.json，readThread 重注入", async () => {
  const baseDir = await mkdtemp(join(tmpdir(), "ooc-comp-"));
  try {
    await ensureStoneRepo({ baseDir });
    const { instantiateBuiltinClassObjects } = await import("@ooc/core/app/server/bootstrap/instantiate-classes");
    await instantiateBuiltinClassObjects({ baseDir });

    const thread = mkSupervisorThread(baseDir);
    // 放一条真业务窗（talk）+ 注入 member 窗，确保落盘路径有内容可比。
    thread.contextWindows = [
      { id: "w_talk_x", class: "talk", parentWindowId: "root", title: "t", status: "open", createdAt: Date.now(),
        target: "user", targetThreadId: "root", conversationId: "c" },
    ];
    await injectMemberWindowsIfObjectThread(thread);
    expect(thread.contextWindows.some((w: any) => w.class === "filesystem")).toBe(true);

    await writeThread(thread);

    // 落盘的 thread-context.json **不含** filesystem 窗（isMemberWindow 被 isNonPersistedWindow 剔除）。
    const tcPath = join(baseDir, "flows", "_test_comp", "objects", "supervisor", "threads", "root", "thread-context.json");
    expect(existsSync(tcPath)).toBe(true);
    const persisted = JSON.parse(readFileSync(tcPath, "utf8"));
    const persistedEntries = (persisted.contextWindows ?? []) as any[];
    const persistedClasses = persistedEntries.map((w) => w.class);
    expect(persistedClasses).not.toContain("filesystem");
    // 真业务窗（talk）仍持久化为一条 entry（对照）；但 talk-family 的 class 是 POV 投影
    // （context.md core 7），不落盘——读回时由 computeProjectionClass 重算。故按 id 断言其
    // entry 存在、且磁盘上 class 字段缺省。
    const talkEntry = persistedEntries.find((w) => w.id === "w_talk_x");
    expect(talkEntry).toBeDefined();
    expect(talkEntry.class).toBeUndefined();

    // readThread 冷恢复时重注入 member 窗 → 再次可见、可 exec；talk 窗 class 经 readThread 重算回 "talk"。
    const reread = await readThread({ baseDir, sessionId: "_test_comp", objectId: "supervisor" }, "root");
    expect(reread?.contextWindows?.some((w: any) => w.class === "filesystem")).toBe(true);
    expect(reread?.contextWindows?.find((w: any) => w.id === "w_talk_x")?.class).toBe("talk");
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});
