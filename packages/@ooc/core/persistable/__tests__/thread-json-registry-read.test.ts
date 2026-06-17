/**
 * readThread —— thread-context.json 单一权威读路径（Wave4）。
 *
 * Wave4 后 readThread 的窗状态来源是 thread-context.json（hydrateContextWindows），
 * 不再读旧 ooc-6「context.json registry + params.order/compressLevel 投影」双写期路径
 * ——那条 registry-priority 读路径已退役（writeContextRegistry/writeRuntimeObjectState
 * 仍作为孤立 IO 原语存在，但 readThread 不再消费）。本文件验证仍存在的行为：
 *   1. registry references missing object → graceful（thread-context.json 不引它即不出现）。
 *   2. builtin inline 窗经 writeThread 落 thread-context.json，reload 还原。
 *   3. self 门面窗不进 thread.json（contextWindows 整体不入 thread.json），reload 经 init 重注入。
 */

import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeThread, readThread, threadFile } from "@ooc/builtins/agent/thread/persistable/thread-json";
import { writeContextRegistry, __resetSerialQueueForTests } from "../index";
import type { ThreadPersistenceRef, FlowObjectRef } from "../common";
import { makeThread } from "../../__tests__/make-thread";
// 触发 builtin class 注册（hydrate 用 builtinRegistry.has 判定保留/丢弃窗）。
import "@ooc/core/runtime/register-builtins";

describe("readThread — thread-context.json 单一权威读路径", () => {
  let baseDir: string;
  let flowRef: FlowObjectRef;
  let persistence: ThreadPersistenceRef;

  beforeEach(async () => {
    __resetSerialQueueForTests();
    baseDir = await mkdtemp(join(tmpdir(), "ooc-readthread-reg-"));
    flowRef = { baseDir, sessionId: "sess_p52", objectId: "agent_p52" };
    persistence = { ...flowRef, threadId: "t_main" };
  });

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  it("孤立 context registry 引用不进 thread-context.json → reload 不出现该对象（graceful）", async () => {
    // 旧 ooc-6 context.json registry 已不被 readThread 消费；即便写了一条指向不存在
    // 对象的 registry entry，readThread（读 thread-context.json）也不会把它投影出来。
    await writeContextRegistry(persistence, {
      version: 1,
      members: [
        { objectId: "todo_ghost", params: { order: 0 } }, // 旧 registry，readThread 不读
      ],
    });
    const thread = makeThread({ id: "t_main", persistence, skipCreatorWindow: true });
    thread.contextWindows = [];
    await writeThread(thread);

    const restored = await readThread(flowRef, "t_main");
    expect(restored).toBeDefined();
    const ghost = restored!.contextWindows.find((w) => w.id === "todo_ghost");
    expect(ghost).toBeUndefined();
  });

  it("builtin inline 窗经 writeThread 落 thread-context.json，reload 还原（单点刷）", async () => {
    // builtin feature 窗（agent/todo，已注册）由 writeThread 单点刷进 thread-context.json，
    // reload 经 thread-context.json hydrate 还原——不再依赖已退役的 thread.contextWindows fallback。
    const thread = makeThread({ id: "t_main", persistence, skipCreatorWindow: true });
    thread.contextWindows = [
      {
        id: "todo_legacy",
        class: "agent/todo",
        title: "builtin todo",
        status: "open",
        createdAt: 1,
        data: { content: "persisted via thread-context.json", status: "open" },
      } as never,
    ];
    await writeThread(thread);

    const restored = await readThread(flowRef, "t_main");
    const ids = restored!.contextWindows.map((w) => w.id);
    expect(ids).toContain("todo_legacy");
  });

  // 回归 gate：self 门面窗的 contextWindows 整体不进 thread.json（stripVolatileForPersist
  // 剥掉 contextWindows 字段，避免 thread.json 含 self / thread-context.json 不含 self 的双写
  // 漂移），reload 时由 readThread→initContextWindows→injectSelfWindowIfObjectThread 幂等重注入。
  it("self window 不落 thread.json，reload 经 init 重现（双写漂移根治）", async () => {
    // makeThread（不 skipCreatorWindow）经 initContextWindows 注入 self window（objectId=agent_p52，非 user）。
    // Wave4：isSelfWindow 标记落在窗的投影态 win 上（win.isSelfWindow），非顶层字段。
    const thread = makeThread({ id: "t_main", persistence });
    const selfInMem = thread.contextWindows.find(
      (w) => (w as { win?: { isSelfWindow?: boolean } }).win?.isSelfWindow === true,
    );
    expect(selfInMem?.id).toBe("agent_p52"); // 内存中确有 self 门面窗

    await writeThread(thread);

    // thread.json 落盘后整体不含 contextWindows 字段（stripVolatileForPersist 剥离）。
    const rawThreadJson = JSON.parse(await readFile(threadFile(persistence), "utf8")) as {
      contextWindows?: unknown;
    };
    expect(rawThreadJson.contextWindows).toBeUndefined();

    // reload 后 self window 由 init 幂等重注入，不丢
    const restored = await readThread(flowRef, "t_main");
    const selfRestored = restored!.contextWindows.find((w) => w.id === "agent_p52");
    expect(selfRestored).toBeDefined();
    expect(
      (selfRestored as { win?: { isSelfWindow?: boolean } }).win?.isSelfWindow,
    ).toBe(true);
  });
});
