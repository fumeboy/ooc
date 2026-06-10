/**
 * end-reflection-reminder thread-level 集成测试。
 *
 * end-reflection 知识（builtins/root/knowledge/end-reflection.md，activates_on
 * `method::root::end`）应在业务 thread 开 end form 时经完整 buildInputItems 路径渲染进
 * system content；非 end form 时不出现。
 *
 * 不真起 backend / 不调 LLM；buildInputItems 是纯函数。
 */
import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { makeThread } from "@ooc/core/__tests__/make-thread";
import { buildInputItems } from "@ooc/core/thinkable/context";
import { buildProtocolKnowledgeWindows } from "@ooc/core/thinkable/context/protocol";
import type { MethodExecWindow } from "@ooc/core/executable/windows/_shared/types";
import type { ThreadPersistenceRef } from "@ooc/core/persistable/common";

// 触发 windows/ 各 type 注册（root commands "end" / "talk" 等）
import "@ooc/core/executable/windows";

/** end-reflection.md body 的特征短语（仅出现在该篇中）。 */
const END_REFLECTION_MARKER = "memory/<slug>.md";

function makeMethodExecWindow(
  overrides: Partial<MethodExecWindow> & { method: string },
): MethodExecWindow {
  return {
    id: "f_test",
    type: "method_exec",
    parentWindowId: "root",
    title: overrides.method,
    status: "open",
    createdAt: 1,
    description: "",
    accumulatedArgs: {},
    intentPaths: [overrides.method],
    loadedKnowledgePaths: [],
    ...overrides,
  };
}

function setupRef(opts: { sessionId: string; tag: string }): {
  ref: ThreadPersistenceRef;
  cleanup: () => void;
} {
  const tmpRoot = mkdtempSync(join(tmpdir(), `ooc-end-reflection-${opts.tag}-`));
  const ts = Date.now();
  const ref: ThreadPersistenceRef = {
    baseDir: tmpRoot,
    sessionId: opts.sessionId,
    objectId: "alice",
    threadId: `t_test_thinkable_${ts}`,
  };
  return { ref, cleanup: () => rmSync(tmpRoot, { recursive: true, force: true }) };
}

/** 收集 input items 的 system role content。 */
function systemContent(input: Awaited<ReturnType<typeof buildInputItems>>): string {
  return input.input
    .filter((it): it is Extract<typeof it, { type: "message" }> => it.type === "message")
    .filter((it) => it.role === "system")
    .map((it) => it.content)
    .join("\n\n");
}

function paths(windows: { type: string; path?: string }[]): string[] {
  return windows.filter((w) => w.type === "knowledge").map((w) => w.path ?? "");
}

describe("end-reflection-reminder thread-level integration", () => {
  it("业务 thread + end form → input system content 含 end-reflection", async () => {
    const { ref, cleanup } = setupRef({ sessionId: "_test_thinkable_business_end", tag: "business-end" });
    try {
      const thread = makeThread({
        id: ref.threadId,
        persistence: ref,
        extraWindows: [makeMethodExecWindow({ method: "end", id: "f_end_biz" })],
      });

      // 防御性 gate：协议层已激活 end-reflection 篇
      expect(paths(await buildProtocolKnowledgeWindows(thread))).toContain("end-reflection");

      // 完整路径：buildInputItems → system message 含 end-reflection body 关键字段
      const sys = systemContent(await buildInputItems(thread));
      expect(sys).toContain(END_REFLECTION_MARKER);
      expect(sys).toContain('target: "super"');
    } finally {
      cleanup();
    }
  });

  it("业务 thread + 非 end form (talk) → input system content 不含 end-reflection（门控）", async () => {
    const { ref, cleanup } = setupRef({ sessionId: "_test_thinkable_business_talk", tag: "business-talk" });
    try {
      const thread = makeThread({
        id: ref.threadId,
        persistence: ref,
        extraWindows: [makeMethodExecWindow({ method: "talk", id: "f_talk_biz" })],
      });

      expect(paths(await buildProtocolKnowledgeWindows(thread))).not.toContain("end-reflection");
      const sys = systemContent(await buildInputItems(thread));
      expect(sys).not.toContain(END_REFLECTION_MARKER);
    } finally {
      cleanup();
    }
  });
});
