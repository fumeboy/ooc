/**
 * 组合机制（agent 持有 tool-object 成员）—— 确定性集成测试（Wave 4 对象模型）。
 *
 * 证明端到端：agent thread → initThreadContextWindows 注入全局单例 tool-object
 * 成员窗（filesystem/terminal/...，inst.class=`_builtin/<x>`，isMemberWindow 标记落 inst.win）→
 * 经 WindowManager.execObjectMethod(filesystem, grep) 调成员的委托方法造出 search 对象
 * （含真实命中）→ member 窗非持久化（isNonPersistedWindow 经 win 标记剔除，不入
 * thread-context.json，readThread 冷恢复重注入）；inline-持久化的会话窗（thread）则照常落盘。零 LLM。
 *
 * Wave 4 形态迁移：成员窗 inst.class = `_builtin/filesystem`（注册全 id，非裸 "filesystem"）；
 * isMemberWindow 在 inst.win（不在实例顶层）；旧 `mgr.openMethodExec` form 机制退役 →
 * 经 execObjectMethod 直接 dispatch 成员 object method；会话窗 inst.class=THREAD_CLASS_ID、
 * 业务字段（target/targetThreadId）落 inst.data。
 */
import { test, expect } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureStoneRepo } from "@ooc/core/persistable";
import { writeThread, readThread } from "@ooc/builtins/agent/thread/persistable/thread-json";
// side-effect：让 builtinRegistry 持有 filesystem/search 等窗类型（resolveObjectMethod / constructor）。
import "@ooc/core/runtime/register-builtins.js";
import { builtinRegistry } from "@ooc/core/runtime/object-registry.js";
import { initThreadContextWindows } from "@ooc/builtins/agent/thread/thinkable/context/init-windows.js";
import { WindowManager } from "@ooc/core/runtime/window-manager.js";
import {
  materializeWindow,
  getSessionObjectTable,
} from "@ooc/core/runtime/session-object-table.js";
import { objectDataOf } from "@ooc/core/_shared/types/context-window.js";
import { THREAD_CLASS_ID } from "@ooc/core/_shared/types/constants.js";
import type { OocObjectRef } from "@ooc/core/runtime/ooc-class.js";

const FILESYSTEM_MEMBER_ID = "_builtin/filesystem";

function mkSupervisorThread(baseDir: string): any {
  return {
    id: "root",
    status: "running",
    events: [],
    persistence: { baseDir, sessionId: "_test_comp", objectId: "supervisor", threadId: "root" },
    contextWindows: [],
  };
}

test("组合：agent thread → injectMember 注入 filesystem member 窗（inst.class=_builtin/filesystem，isMemberWindow 落 win）", async () => {
  const baseDir = await mkdtemp(join(tmpdir(), "ooc-comp-"));
  try {
    await ensureStoneRepo({ baseDir });

    const thread = mkSupervisorThread(baseDir);
    initThreadContextWindows(thread);

    const fsWin = thread.contextWindows.find(
      (w: OocObjectRef) => w.class === FILESYSTEM_MEMBER_ID,
    );
    expect(fsWin).toBeDefined();
    // isMemberWindow 标记在 inst.win（不在实例顶层）。
    expect((fsWin.win as { isMemberWindow?: boolean }).isMemberWindow).toBe(true);
    expect(fsWin.id).toBe(FILESYSTEM_MEMBER_ID);
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test("组合机制命门：execObjectMethod(filesystem, grep) 经成员委托方法造出 search 对象（含真实命中）", async () => {
  const baseDir = await mkdtemp(join(tmpdir(), "ooc-comp-"));
  try {
    await ensureStoneRepo({ baseDir });
    // 写一个已知内容的探针文件，保证 grep 有真实命中（强化：不止「窗存在」，还要命中>0）。
    await writeFile(join(baseDir, "probe.txt"), "OOC_MARKER alpha\nbeta OOC_MARKER\n", "utf8");

    const thread = mkSupervisorThread(baseDir);
    initThreadContextWindows(thread);

    const mgr = WindowManager.fromThread(thread, builtinRegistry);
    // grep 是 filesystem 成员的委托 object method（经 ctx.runtime.instantiate 造 search 子对象）。
    await mgr.execObjectMethod(
      FILESYSTEM_MEMBER_ID,
      "grep",
      { pattern: "OOC_MARKER", path: baseDir },
      thread,
    );

    const search = mgr.list().find((w) => w.class === "_builtin/filesystem/search");
    expect(search).toBeDefined();
    // 业务字段经 session 对象表按 ref.id 解析（B→A：窗不持 data）。
    const data = objectDataOf(search!, getSessionObjectTable(thread)) as {
      kind: string;
      matches: unknown[];
    };
    expect(data.kind).toBe("grep");
    expect(data.matches.length).toBeGreaterThan(0); // 真实命中，证明是经 filesystem 成员真跑了 grep
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test("非持久化往返：member 窗不入 thread-context.json；inline 会话窗落盘，readThread 重注入 member 窗", async () => {
  const baseDir = await mkdtemp(join(tmpdir(), "ooc-comp-"));
  try {
    await ensureStoneRepo({ baseDir });

    const thread = mkSupervisorThread(baseDir);
    // 放一条真业务会话窗（thread 实例，inline 持久化）+ 注入 member 窗，确保落盘路径有内容可比。
    // B→A：窗=ref（不持 data）；data 经 materializeWindow 登记进 session 对象表，落盘时由表取回。
    const talkWindow: OocObjectRef = materializeWindow(thread, {
      id: "w_talk_x",
      class: THREAD_CLASS_ID,
      data: { target: "user", targetThreadId: "root" },
      parentWindowId: "root",
      title: "t",
      status: "open",
      createdAt: Date.now(),
    });
    thread.contextWindows = [talkWindow];
    initThreadContextWindows(thread);
    expect(
      thread.contextWindows.some((w: OocObjectRef) => w.class === FILESYSTEM_MEMBER_ID),
    ).toBe(true);

    await writeThread(thread);

    // 落盘的 thread-context.json **不含** filesystem 成员窗（win.isMemberWindow 被
    // isNonPersistedWindow 剔除）。
    const tcPath = join(baseDir, "flows", "_test_comp", "objects", "supervisor", "threads", "root", "thread-context.json");
    expect(existsSync(tcPath)).toBe(true);
    const persisted = JSON.parse(readFileSync(tcPath, "utf8"));
    // 磁盘 entry 是平铺形态（class/data 在顶层；内存 .object 才嵌套）。
    const persistedEntries = (persisted.contextWindows ?? []) as { id: string; class: string }[];
    const persistedClasses = persistedEntries.map((w) => w.class);
    expect(persistedClasses).not.toContain(FILESYSTEM_MEMBER_ID);
    // 会话窗（thread 实例）inline 持久化整窗落盘：entry 在、磁盘 class=THREAD_CLASS_ID 整窗保留。
    const talkEntry = persistedEntries.find((w) => w.id === "w_talk_x");
    expect(talkEntry).toBeDefined();
    expect(talkEntry!.class).toBe(THREAD_CLASS_ID);

    // readThread 冷恢复时**内部**重注入 member 窗（thread-persist 末尾调
    // initThreadContextWindows）→ 再次可见、可 exec；会话窗 inline 整窗 hydrate 回。
    const reread = await readThread({ baseDir, sessionId: "_test_comp", objectId: "supervisor" }, "root");
    expect(
      reread?.contextWindows?.some((w: OocObjectRef) => w.class === FILESYSTEM_MEMBER_ID),
    ).toBe(true);
    expect(
      reread?.contextWindows?.find((w: OocObjectRef) => w.id === "w_talk_x")?.class,
    ).toBe(THREAD_CLASS_ID);
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});
