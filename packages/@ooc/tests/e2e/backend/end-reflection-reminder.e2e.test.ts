/**
 * Round 11 G2 end-reflection-reminder thread-level 集成测试
 *
 * 体验官 Round 14 报告（docs/2026-05-27-round-14-experience-report.md §Round 11）
 * 提示："本轮 LLM 没有自然调到 end command，需补 thread-level 集成测试" —— 单测覆盖
 * 了 synthesizer.collectExecutableKnowledgeEntries 单元路径，但完整路径（thread →
 * buildInputItems → input items 的 system message）从未在 e2e 跑通过。
 *
 * Design spec:  meta/object.doc.ts:reflectable.children.end_reflection_reminder
 * Injection:    src/thinkable/knowledge/synthesizer.ts (collectExecutableKnowledgeEntries)
 * Unit tests:   src/thinkable/reflectable/reflectable-knowledge.test.ts
 *
 * 本 e2e 走 `buildInputItems` 完整路径，验证三种 thread 情况：
 *   1. 业务 thread + end form     → input system content **含** reminder body 关键字段
 *   2. super session  + end form  → input system content **不含** reminder（避免套娃）
 *   3. 业务 thread + 非 end form  → input system content **不含** reminder（门控条件）
 *
 * 不真起 backend / 不调 LLM；buildInputItems 是纯函数。
 */
import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { makeThread } from "@ooc/core/__tests__/make-thread";
import { buildInputItems } from "@ooc/core/thinkable/context";
import { buildProtocolKnowledgeWindows, collectProtocolEntries } from "@ooc/core/thinkable/context/protocol";
import {
  END_REFLECTION_REMINDER_KNOWLEDGE,
  END_REFLECTION_REMINDER_PATH,
} from "@ooc/core/thinkable/reflectable/reflectable-knowledge";
import type { MethodExecWindow } from "@ooc/core/executable/windows/_shared/types";
import type { ThreadPersistenceRef } from "@ooc/core/persistable/common";

// 触发 windows/ 各 type 注册（root commands "end" / "talk" 等）
import "@ooc/core/executable/windows";

function makeMethodExecWindow(
  overrides: Partial<MethodExecWindow> & { command: string },
): MethodExecWindow {
  return {
    id: "f_test",
    type: "method_exec",
    parentWindowId: "root",
    title: overrides.command,
    status: "open",
    createdAt: 1,
    description: "",
    accumulatedArgs: {},
    commandPaths: [overrides.command],
    loadedKnowledgePaths: [],
    ...overrides,
  };
}

/**
 * 用 mkdtemp 申请独立 tmp world 目录；buildInputItems 自身不读 stone 文件（仅
 * skill_index / activator 派生路径才读），但 persistence 必须存在以触发
 * synthesizer 的注入门控逻辑。
 *
 * session 卫生（CLAUDE.md / harness 约定）：sessionId 一律 `_test_thinkable_<ts>` 前缀；
 * threadId 走相同规范，避免污染 `.ooc-world/flows/` 真目录（这里用 tmp world 物理隔离）。
 */
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
  return {
    ref,
    cleanup: () => rmSync(tmpRoot, { recursive: true, force: true }),
  };
}

/** 收集 input items 的 system role content，便于断言"reminder 进了渲染层"。 */
function systemContent(input: Awaited<ReturnType<typeof buildInputItems>>): string {
  return input.input
    .filter((it): it is Extract<typeof it, { type: "message" }> => it.type === "message")
    .filter((it) => it.role === "system")
    .map((it) => it.content)
    .join("\n\n");
}

describe("[round-11] end-reflection-reminder thread-level integration", () => {
  it("业务 thread + end form → input system content 含 reminder body 关键字段", async () => {
    const { ref, cleanup } = setupRef({
      sessionId: "_test_thinkable_business_end",
      tag: "business-end",
    });
    try {
      const thread = makeThread({
        id: ref.threadId,
        persistence: ref,
        extraWindows: [
          makeMethodExecWindow({ command: "end", id: "f_end_biz" }),
        ],
      });

      // 1. 直接断 synthesizer entries 也含（与单测对齐，作为防御性 gate）
      const collected = { knowledgeEntries: collectProtocolEntries(thread), contextWindows: buildProtocolKnowledgeWindows(thread) };
      expect(collected.knowledgeEntries[END_REFLECTION_REMINDER_PATH]).toBe(
        END_REFLECTION_REMINDER_KNOWLEDGE,
      );

      // 2. 完整路径：buildInputItems → input 的 system message 含 reminder body 关键字段
      const items = await buildInputItems(thread);
      const sys = systemContent(items);
      expect(sys).toContain(END_REFLECTION_REMINDER_PATH);
      // G3 修复 sentinel：target: "super" + title: 而非 initialMessage 残留
      expect(sys).toContain('target: "super"');
      expect(sys).toContain("title:");
      // 与单测同步的语义断言（核心 hint 措辞）
      expect(sys).toContain("memory/<slug>.md");
      expect(sys).toContain("endSummary");

      // 3. 合成 KnowledgeWindow 也应出现于 contextWindows
      const kn = (collected.contextWindows ?? []).find(
        (w) => w.type === "knowledge" && (w as { path?: string }).path === END_REFLECTION_REMINDER_PATH,
      );
      expect(kn).toBeDefined();
      expect((kn as { source?: string }).source).toBe("protocol");
    } finally {
      cleanup();
    }
  });

  it("super session + end form → input system content 不含 reminder（避免套娃）", async () => {
    const { ref, cleanup } = setupRef({
      sessionId: "super", // 真实 SUPER_SESSION_ID 字面量
      tag: "super-end",
    });
    try {
      const thread = makeThread({
        id: ref.threadId,
        persistence: ref,
        extraWindows: [
          makeMethodExecWindow({ command: "end", id: "f_end_super" }),
        ],
      });

      const collected = { knowledgeEntries: collectProtocolEntries(thread), contextWindows: buildProtocolKnowledgeWindows(thread) };
      expect(collected.knowledgeEntries[END_REFLECTION_REMINDER_PATH]).toBeUndefined();

      const items = await buildInputItems(thread);
      const sys = systemContent(items);
      // 完整 PATH 不应作为 knowledge_window path 出现在 system content
      expect(sys).not.toContain(END_REFLECTION_REMINDER_PATH);
      // 防御性：reminder 的特征短语（仅出现在 reminder body 中）也不该出现
      // ——避免某天 reminder 被同义文本"借用"导致 false positive
      expect(sys).not.toContain("在 end 之前: 考虑通过 super flow 沉淀经验");
    } finally {
      cleanup();
    }
  });

  it("业务 thread + 非 end form (talk) → input system content 不含 reminder（门控条件）", async () => {
    const { ref, cleanup } = setupRef({
      sessionId: "_test_thinkable_business_talk",
      tag: "business-talk",
    });
    try {
      const thread = makeThread({
        id: ref.threadId,
        persistence: ref,
        extraWindows: [
          makeMethodExecWindow({ command: "talk", id: "f_talk_biz" }),
        ],
      });

      const collected = { knowledgeEntries: collectProtocolEntries(thread), contextWindows: buildProtocolKnowledgeWindows(thread) };
      expect(collected.knowledgeEntries[END_REFLECTION_REMINDER_PATH]).toBeUndefined();

      const items = await buildInputItems(thread);
      const sys = systemContent(items);
      expect(sys).not.toContain(END_REFLECTION_REMINDER_PATH);
      expect(sys).not.toContain("在 end 之前: 考虑通过 super flow 沉淀经验");
    } finally {
      cleanup();
    }
  });
});
