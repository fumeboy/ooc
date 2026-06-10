/**
 * ooc-6 P5'.2 — readThread 优先从 context.json registry 读
 *
 * 验证：
 * 1. 当 registry 存在 + state.json 存在时，readThread 应从 registry 拉对象，覆盖 thread.contextWindows[] 里的旧 entry
 * 2. registry.params.order 决定 contextWindows 顺序
 * 3. registry.params.compressLevel 投影回 ContextWindow.compressLevel
 * 4. registry 引用了不存在的 state.json → graceful skip + warn
 * 5. registry 为空时 fallback 到旧 nested context/ 路径
 */

import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeThread, readThread, threadFile } from "../thread-json";
import {
  writeRuntimeObjectState,
  writeContextRegistry,
  threadDir,
  __resetSerialQueueForTests,
} from "../index";
import type { ThreadPersistenceRef, FlowObjectRef } from "../common";
import { makeThread } from "../../__tests__/make-thread";

describe("readThread — registry-priority read path (P5'.2)", () => {
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

  it("registry hit: 从 state.json 拉对象，按 params.order 排序", async () => {
    // §10：thread-context.json 是最高权威；为可达 registry (P5'.1) 路径，thread.contextWindows
    // 必须为空（writeThread 写出空 thread-context.json → 回落 registry）。
    const thread = makeThread({ id: "t_main", persistence, skipCreatorWindow: true });
    thread.contextWindows = [];
    await writeThread(thread);

    // 写两个 flat state.json
    await writeRuntimeObjectState(
      { baseDir, sessionId: "sess_p52", objectId: "todo_b" },
      {
        id: "todo_b",
        class: "todo",
        title: "second todo",
        status: "open",
        content: "registry b",
        createdAt: 2,
      } as never,
    );
    await writeRuntimeObjectState(
      { baseDir, sessionId: "sess_p52", objectId: "todo_a" },
      {
        id: "todo_a",
        class: "todo",
        title: "first todo",
        status: "open",
        content: "registry a",
        createdAt: 3,
      } as never,
    );

    // 写 registry (顺序 a 先 b 后, 但故意 order 反向, 验证 sort)
    await writeContextRegistry(persistence, {
      version: 1,
      members: [
        { objectId: "todo_b", params: { order: 1 } },
        { objectId: "todo_a", params: { order: 0 } },
      ],
    });

    const restored = await readThread(flowRef, "t_main");
    expect(restored).toBeDefined();
    const ids = restored!.contextWindows.map((w) => w.id);
    // todo_a (order 0) 在前, todo_b (order 1) 在后（registry 排序）
    // 注意: initContextWindows 会兜底注入 creator do_window (id = parent objectId)
    const filtered = ids.filter((id) => id.startsWith("todo_"));
    expect(filtered).toEqual(["todo_a", "todo_b"]);
  });

  it("registry params 投影回 ContextWindow: compressLevel + parentObjectId", async () => {
    await writeRuntimeObjectState(
      { baseDir, sessionId: "sess_p52", objectId: "todo_x" },
      {
        id: "todo_x",
        class: "todo",
        title: "with params",
        status: "open",
        content: "",
        createdAt: 1,
      } as never,
    );
    await writeContextRegistry(persistence, {
      version: 1,
      members: [
        {
          objectId: "todo_x",
          params: { order: 0, compressLevel: 2, parentObjectId: "root" },
        },
      ],
    });
    const thread = makeThread({ id: "t_main", persistence, skipCreatorWindow: true });
    thread.contextWindows = [];
    await writeThread(thread);

    const restored = await readThread(flowRef, "t_main");
    const w = restored!.contextWindows.find((w) => w.id === "todo_x");
    expect(w).toBeDefined();
    expect((w as { compressLevel?: number }).compressLevel).toBe(2);
    expect((w as { parentWindowId?: string }).parentWindowId).toBe("root");
  });

  it("registry references missing state.json → skip + warn (graceful)", async () => {
    await writeContextRegistry(persistence, {
      version: 1,
      members: [
        { objectId: "todo_ghost", params: { order: 0 } }, // state.json 不存在
      ],
    });
    const thread = makeThread({ id: "t_main", persistence, skipCreatorWindow: true });
    thread.contextWindows = [];
    await writeThread(thread);

    // 应当不抛错，graceful skip
    const restored = await readThread(flowRef, "t_main");
    expect(restored).toBeDefined();
    // 仅剩 init 兜底注入的 root creator
    const ghost = restored!.contextWindows.find((w) => w.id === "todo_ghost");
    expect(ghost).toBeUndefined();
  });

  it("builtin window 经 writeThread 落 thread-context.json，reload 还原（§10 单点刷）", async () => {
    // §10：builtin feature 窗（todo）由 writeThread 单点刷进 thread-context.json（inline），
    // reload 经 thread-context.json hydrate 还原——不再依赖已退役的 thread.contextWindows fallback。
    const thread = makeThread({ id: "t_main", persistence, skipCreatorWindow: true });
    thread.contextWindows = [
      {
        id: "todo_legacy",
        class: "todo",
        title: "builtin todo",
        status: "open",
        content: "persisted via thread-context.json",
        createdAt: 1,
      } as never,
    ];
    await writeThread(thread);

    const restored = await readThread(flowRef, "t_main");
    const ids = restored!.contextWindows.map((w) => w.id);
    expect(ids).toContain("todo_legacy");
  });

  // 2026-06-09 回归 gate：self 门面窗不持久化进 thread.json（与 thread-context.json 写盘端
  // 的 isNonPersistedWindow 过滤对齐，根治 thread.json 含 self / thread-context.json 不含 self
  // 的双写漂移），但 reload 时由 readThread→initContextWindows→injectSelfWindowIfObjectThread
  // 幂等重注入，行为不丢。
  it("self window 不落 thread.json，reload 经 init 重现（双写漂移根治）", async () => {
    // makeThread（不 skipCreatorWindow）经 initContextWindows 注入 self window（objectId=agent_p52，非 user）
    const thread = makeThread({ id: "t_main", persistence });
    const selfInMem = thread.contextWindows.find(
      (w) => (w as { isSelfWindow?: boolean }).isSelfWindow === true,
    );
    expect(selfInMem?.id).toBe("agent_p52"); // 内存中确有 self 门面窗

    await writeThread(thread);

    // thread.json 落盘后不含 self window（isNonPersistedWindow 剔除）
    const rawThreadJson = JSON.parse(await readFile(threadFile(persistence), "utf8")) as {
      contextWindows?: Array<{ id: string; isSelfWindow?: boolean }>;
    };
    const selfPersisted = (rawThreadJson.contextWindows ?? []).find(
      (w) => w.isSelfWindow === true || w.id === "agent_p52",
    );
    expect(selfPersisted).toBeUndefined();

    // reload 后 self window 由 init 幂等重注入，不丢
    const restored = await readThread(flowRef, "t_main");
    const selfRestored = restored!.contextWindows.find((w) => w.id === "agent_p52");
    expect(selfRestored).toBeDefined();
    expect((selfRestored as { isSelfWindow?: boolean }).isSelfWindow).toBe(true);
  });
});
