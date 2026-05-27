/**
 * P0d — 自然衰减 e2e。
 *
 * Design: docs/2026-05-25-context-compression-design.md §4.3
 * Meta:   meta/object.doc.ts:thinkable.children.context_budget.patches.natural_decay
 *
 * 不走真 LLM:直接构造 thread + 调用 applyNaturalDecay 推进若干"轮次",
 * 验证 idle-fold / age-fold / double-fold / cascade-fold + ProcessEvent 落事件 +
 * thread.json 持久化不带 _decayMeta。
 *
 * 不依赖 RUN_BACKEND_E2E gate:fixture-based unit-style 验收,可直接 bun test。
 */

import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { makeThread } from "@src/__tests__/make-thread";
import { applyNaturalDecay, DEFAULT_DECAY_CONFIG } from "@src/thinkable/context/budget";
import { generateWindowId } from "@src/executable/windows/_shared/types";
import type {
  ContextWindow,
  DoWindow,
  FileWindow,
  KnowledgeWindow,
  SearchWindow,
} from "@src/executable/windows/_shared/types";
import { readThread, writeThread } from "@src/persistable/thread-json";
import type { ThreadPersistenceRef } from "@src/persistable/common";

// 触发 windows/ side-effect 注册 (registry / commands)。
import "@src/executable/windows";

const N = DEFAULT_DECAY_CONFIG.idleRoundsN;
const K = DEFAULT_DECAY_CONFIG.doubleFoldRoundsK;

const findWin = (thread: { contextWindows: ContextWindow[] }, id: string) =>
  thread.contextWindows.find((w) => w.id === id);

describe("[p0d] context budget — applyNaturalDecay", () => {
  it("idle-fold: closed 状态持续 N 轮 → level 0→1, level 1 再持续 K 轮 → 1→2", () => {
    const thread = makeThread();

    // search_window status=closed → idle-fold 候选
    const searchId = generateWindowId("search");
    const search: SearchWindow = {
      id: searchId,
      type: "search",
      title: "search done",
      status: "closed",
      createdAt: Date.now(),
      kind: "grep",
      query: "foo",
      matches: [],
      truncated: false,
    };

    // do_window status=running → IO 等待,豁免衰减
    const doId = generateWindowId("do");
    const doW: DoWindow = {
      id: doId,
      type: "do",
      title: "running task",
      status: "running",
      createdAt: Date.now(),
      targetThreadId: "t_child",
    };

    // knowledge_window status=closed → idle-fold 候选
    const kId = generateWindowId("knowledge");
    const kn: KnowledgeWindow = {
      id: kId,
      type: "knowledge",
      title: "knowledge",
      status: "closed",
      createdAt: Date.now(),
      source: "explicit",
      path: "/tmp/k.md",
    };

    thread.contextWindows.push(search, doW, kn);

    // 跑 N 轮 → search / knowledge 应该被 idle-fold 到 1
    for (let i = 0; i < N; i++) {
      applyNaturalDecay(thread);
    }

    expect(findWin(thread, searchId)!.compressLevel ?? 0).toBe(1);
    expect(findWin(thread, kId)!.compressLevel ?? 0).toBe(1);
    // do_window IO 等待 → 不该被折叠
    expect(findWin(thread, doId)!.compressLevel ?? 0).toBe(0);

    // 检查 events 中是否出现 idle-fold reason 的 context_compressed
    const idleEvents = thread.events.filter(
      (e) =>
        e.category === "context_change" &&
        e.kind === "context_compressed" &&
        e.reason === "idle-fold",
    );
    expect(idleEvents.length).toBeGreaterThan(0);
    for (const e of idleEvents) {
      if (e.category === "context_change" && e.kind === "context_compressed") {
        expect(e.levelChange).toBe("0→1");
      }
    }

    // 继续跑 K 轮 → search/knowledge 应该 double-fold 到 2
    for (let i = 0; i < K; i++) {
      applyNaturalDecay(thread);
    }

    expect(findWin(thread, searchId)!.compressLevel ?? 0).toBe(2);
    expect(findWin(thread, kId)!.compressLevel ?? 0).toBe(2);
    expect(findWin(thread, doId)!.compressLevel ?? 0).toBe(0);

    // double-fold event 出现
    const doubleEvents = thread.events.filter(
      (e) =>
        e.category === "context_change" &&
        e.kind === "context_compressed" &&
        e.reason === "double-fold",
    );
    expect(doubleEvents.length).toBeGreaterThan(0);
    for (const e of doubleEvents) {
      if (e.category === "context_change" && e.kind === "context_compressed") {
        expect(e.levelChange).toBe("1→2");
      }
    }
  });

  it("age-fold: 非 idle 状态但 M 轮无访问 → level 0→1", () => {
    const thread = makeThread();

    // file_window status=open (非 idle), 无 exec 触达 → ageRoundsM 后 age-fold
    const fileId = generateWindowId("file");
    const file: FileWindow = {
      id: fileId,
      type: "file",
      title: "file.txt",
      status: "open",
      createdAt: Date.now(),
      path: "/tmp/file.txt",
    };
    thread.contextWindows.push(file);

    // 用一个较短的 ageRoundsM 来减少轮数; idleRoundsN 设很大避免被 idle-fold
    const cfg = { ...DEFAULT_DECAY_CONFIG, ageRoundsM: 5, idleRoundsN: 999 };

    for (let i = 0; i < cfg.ageRoundsM; i++) {
      applyNaturalDecay(thread, cfg);
    }

    expect(findWin(thread, fileId)!.compressLevel ?? 0).toBe(1);

    const ageEvents = thread.events.filter(
      (e) =>
        e.category === "context_change" &&
        e.kind === "context_compressed" &&
        e.reason === "age-fold",
    );
    expect(ageEvents.length).toBeGreaterThan(0);
  });

  it("cascade-fold: parent 被 fold 后所有 child 同档", () => {
    const thread = makeThread();

    // parent: do_window archived → 进入 idle-set
    const parentId = generateWindowId("do");
    const parent: DoWindow = {
      id: parentId,
      type: "do",
      title: "parent archived",
      status: "archived",
      createdAt: Date.now(),
      targetThreadId: "t_child",
    };
    // child: file_window status=open (非 idle), 单看自己不该被 idle-fold,
    //        但 cascade 应把它拉到 parent 的档位
    const child1Id = generateWindowId("file");
    const child1: FileWindow = {
      id: child1Id,
      type: "file",
      title: "child file",
      status: "open",
      createdAt: Date.now(),
      path: "/tmp/c1.txt",
      parentWindowId: parentId,
    };
    const child2Id = generateWindowId("search");
    const child2: SearchWindow = {
      id: child2Id,
      type: "search",
      title: "child search",
      status: "open",
      createdAt: Date.now(),
      kind: "glob",
      query: "x",
      matches: [],
      truncated: false,
      parentWindowId: parentId,
    };

    thread.contextWindows.push(parent, child1, child2);

    // 跑 N 轮 → parent idle-fold 到 1, child cascade 到 1
    for (let i = 0; i < N; i++) {
      applyNaturalDecay(thread);
    }

    expect(findWin(thread, parentId)!.compressLevel).toBe(1);
    expect(findWin(thread, child1Id)!.compressLevel).toBe(1);
    expect(findWin(thread, child2Id)!.compressLevel).toBe(1);

    const cascadeEvents = thread.events.filter(
      (e) =>
        e.category === "context_change" &&
        e.kind === "context_compressed" &&
        e.reason === "cascade-fold",
    );
    expect(cascadeEvents.length).toBeGreaterThan(0);
    for (const e of cascadeEvents) {
      if (e.category === "context_change" && e.kind === "context_compressed") {
        expect(e.windowIds.length).toBeGreaterThan(0);
        expect(e.windowIds).toContain(child1Id);
        expect(e.windowIds).toContain(child2Id);
      }
    }
  });

  it("exempt: root / command_exec(open|executing) 永不被衰减 (Round 16 精修后)", () => {
    // Round 16 (2026-05-27): command_exec.status=failed 不再豁免, 改用 status=open 测豁免。
    // 完整新规则: isDecayExempt = (type=root) || (type=command_exec && status∈{open,executing})
    const thread = makeThread();
    thread.contextWindows.push({
      id: "root",
      type: "root",
      title: "root",
      status: "active" as const,
      createdAt: Date.now(),
    } as ContextWindow);
    thread.contextWindows.push({
      id: "f_test_exec",
      type: "command_exec",
      title: "command form",
      status: "open" as const,
      createdAt: Date.now(),
      parentWindowId: "root",
    } as ContextWindow);

    // 跑 50 轮 >> N + K
    for (let i = 0; i < 50; i++) {
      applyNaturalDecay(thread);
    }
    expect(findWin(thread, "root")!.compressLevel ?? 0).toBe(0);
    expect(findWin(thread, "f_test_exec")!.compressLevel ?? 0).toBe(0);
  });

  it("touch reset: 触达 window 的 exec 事件应重置 sinceExecRounds", () => {
    const thread = makeThread();
    const fileId = generateWindowId("file");
    const file: FileWindow = {
      id: fileId,
      type: "file",
      title: "file.txt",
      status: "open",
      createdAt: Date.now(),
      path: "/tmp/file.txt",
    };
    thread.contextWindows.push(file);

    const cfg = { ...DEFAULT_DECAY_CONFIG, ageRoundsM: 4, idleRoundsN: 999 };

    // 跑 3 轮 (< ageRoundsM)
    for (let i = 0; i < 3; i++) {
      applyNaturalDecay(thread, cfg);
    }
    expect(findWin(thread, fileId)!.compressLevel ?? 0).toBe(0);

    // 模拟 LLM 在第 4 轮前触达此 window
    thread.events.push({
      category: "llm_interaction",
      kind: "function_call",
      callId: "c1",
      toolName: "exec",
      arguments: { window_id: fileId, command: "read_more" },
    });

    // 再跑 3 轮: 由于 touch 重置, sinceExecRounds 从 0 重新累计, 仍 < 4
    for (let i = 0; i < 3; i++) {
      applyNaturalDecay(thread, cfg);
    }
    expect(findWin(thread, fileId)!.compressLevel ?? 0).toBe(0);

    // 再跑 2 轮总计 5 轮 (>= 4): 应该 age-fold
    for (let i = 0; i < 2; i++) {
      applyNaturalDecay(thread, cfg);
    }
    expect(findWin(thread, fileId)!.compressLevel ?? 0).toBe(1);
  });

  it("持久化: _decayMeta 不进 thread.json", async () => {
    const tmpRoot = mkdtempSync(join(tmpdir(), "ooc-p0d-persist-"));
    try {
      const ref: ThreadPersistenceRef = {
        baseDir: tmpRoot,
        sessionId: "_test_thinkable_p0d_persist",
        objectId: "test-obj",
        threadId: "t_persist",
      };
      const thread = makeThread({ persistence: ref, id: "t_persist" });

      const searchId = generateWindowId("search");
      const search: SearchWindow = {
        id: searchId,
        type: "search",
        title: "search done",
        status: "closed",
        createdAt: Date.now(),
        kind: "grep",
        query: "foo",
        matches: [],
        truncated: false,
      };
      thread.contextWindows.push(search);

      // 跑 N 轮 → search 被 fold 到 1, _decayMeta 已被填充
      for (let i = 0; i < N; i++) {
        applyNaturalDecay(thread);
      }
      const afterDecay = findWin(thread, searchId);
      expect(afterDecay!._decayMeta).toBeDefined();
      expect(afterDecay!.compressLevel).toBe(1);

      await writeThread(thread);
      const restored = await readThread(ref, "t_persist");
      expect(restored).toBeDefined();
      const restoredSearch = restored!.contextWindows.find((w) => w.id === searchId);
      expect(restoredSearch).toBeDefined();
      // compressLevel 应该保留 (不是默认 0)
      expect(restoredSearch!.compressLevel).toBe(1);
      // _decayMeta 不应进 thread.json (会从 undefined 重新累计)
      expect(restoredSearch!._decayMeta).toBeUndefined();
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});
