/**
 * Reflectable knowledge protocol injection — spec 2026-05-18 super-flow-channel.
 *
 * 验证：collectExecutableKnowledgeEntries 仅在 thread.persistence.sessionId
 * === "super" 时注入 REFLECTABLE knowledge entry。
 */
import { describe, expect, it } from "bun:test";
import { buildProtocolKnowledgeWindows, collectProtocolEntries } from "../context/protocol";
import {
  END_REFLECTION_REMINDER_KNOWLEDGE,
  END_REFLECTION_REMINDER_PATH,
  REFLECTABLE_BASIC_PATH,
  REFLECTABLE_KNOWLEDGE,
  REFLECTABLE_METAPROG_KNOWLEDGE,
  REFLECTABLE_METAPROG_PATH,
} from "./reflectable-knowledge";
import { makeThread } from "../../__tests__/make-thread";
import type { MethodExecWindow } from "../../executable/windows/_shared/types";

/** 构造 command_exec window fixture（用于 G2 end-reflection-reminder 测试）。 */
function makeMethodExecWindow(overrides: Partial<MethodExecWindow> & { command: string }): MethodExecWindow {
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

describe("reflectable knowledge protocol injection", () => {
  it("injects REFLECTABLE entry when sessionId === 'super'", async () => {
    const thread = makeThread({
      id: "t_super_alice",
      persistence: {
        baseDir: "/tmp/test", sessionId: "super", objectId: "alice", threadId: "t_super_alice",
      },
    });
    const out = { knowledgeEntries: collectProtocolEntries(thread), contextWindows: buildProtocolKnowledgeWindows(thread) };
    expect(out.knowledgeEntries[REFLECTABLE_BASIC_PATH]).toBe(REFLECTABLE_KNOWLEDGE);
    // U7: metaprog 协议指引也在 super 注入
    expect(out.knowledgeEntries[REFLECTABLE_METAPROG_PATH]).toBe(REFLECTABLE_METAPROG_KNOWLEDGE);
    // 同时检查合成的 KnowledgeWindow 出现
    const kn = (out.contextWindows ?? []).find(
      (w) => w.type === "knowledge" && (w as { path?: string }).path === REFLECTABLE_BASIC_PATH,
    );
    expect(kn).toBeDefined();
    expect((kn as { source?: string }).source).toBe("protocol");

    const mn = (out.contextWindows ?? []).find(
      (w) => w.type === "knowledge" && (w as { path?: string }).path === REFLECTABLE_METAPROG_PATH,
    );
    expect(mn).toBeDefined();
  });

  it("does NOT inject when sessionId is a normal session", async () => {
    const thread = makeThread({
      id: "t_normal",
      persistence: {
        baseDir: "/tmp/test", sessionId: "web-test", objectId: "alice", threadId: "t_normal",
      },
    });
    const out = { knowledgeEntries: collectProtocolEntries(thread), contextWindows: buildProtocolKnowledgeWindows(thread) };
    expect(out.knowledgeEntries[REFLECTABLE_BASIC_PATH]).toBeUndefined();
    expect(out.knowledgeEntries[REFLECTABLE_METAPROG_PATH]).toBeUndefined();
  });

  it("does NOT inject when thread has no persistence (in-memory mode)", async () => {
    const thread = makeThread({ id: "t_in_memory" });
    const out = { knowledgeEntries: collectProtocolEntries(thread), contextWindows: buildProtocolKnowledgeWindows(thread) };
    expect(out.knowledgeEntries[REFLECTABLE_BASIC_PATH]).toBeUndefined();
    expect(out.knowledgeEntries[REFLECTABLE_METAPROG_PATH]).toBeUndefined();
  });

  it("metaprog knowledge mentions key protocol elements", () => {
    expect(REFLECTABLE_METAPROG_KNOWLEDGE).toContain("worktree");
    expect(REFLECTABLE_METAPROG_KNOWLEDGE).toContain("open_worktree");
    expect(REFLECTABLE_METAPROG_KNOWLEDGE).toContain("--stones-branch");
    expect(REFLECTABLE_METAPROG_KNOWLEDGE).toContain("metaprog");
    expect(REFLECTABLE_METAPROG_KNOWLEDGE).toContain("rollback");
  });

  it("REFLECTABLE_KNOWLEDGE includes sediment write contract with frontmatter template", () => {
    // dogfooding 闭环关键（root cause #1）：sediment 必须含 frontmatter 才能被 activator 命中
    expect(REFLECTABLE_KNOWLEDGE).toContain("sediment write contract");
    expect(REFLECTABLE_KNOWLEDGE).toContain("frontmatter");
    expect(REFLECTABLE_KNOWLEDGE).toContain("activates_on");
    // 新 trigger map schema 标志（替代旧 show_description_when / show_content_when）
    expect(REFLECTABLE_KNOWLEDGE).toContain("show_description");
    expect(REFLECTABLE_KNOWLEDGE).toContain("show_content");
    expect(REFLECTABLE_KNOWLEDGE).toContain("window::");
    expect(REFLECTABLE_KNOWLEDGE).toContain("command::");
    // 强调"没有 frontmatter = silently 失效"
    expect(REFLECTABLE_KNOWLEDGE).toMatch(/永远无法激活|永远无法被|断裂/);
    // 完整模板 fence
    expect(REFLECTABLE_KNOWLEDGE).toMatch(/```markdown[\s\S]*---[\s\S]*activates_on[\s\S]*---[\s\S]*```/);
  });
});

/**
 * G2 (Round 11): end-form reflection reminder 注入测试。
 *
 * spec: meta/object.doc.ts:reflectable.children.end_reflection_reminder
 * 注入逻辑：src/thinkable/knowledge/synthesizer.ts collectExecutableKnowledgeEntries
 */
describe("end-reflection-reminder injection (G2)", () => {
  it("injects END_REFLECTION_REMINDER when business thread opens end form", async () => {
    const thread = makeThread({
      id: "t_end_business",
      persistence: {
        baseDir: "/tmp/test", sessionId: "web-test", objectId: "alice", threadId: "t_end_business",
      },
      extraWindows: [makeMethodExecWindow({ command: "end", id: "f_end" })],
    });
    const out = { knowledgeEntries: collectProtocolEntries(thread), contextWindows: buildProtocolKnowledgeWindows(thread) };
    expect(out.knowledgeEntries[END_REFLECTION_REMINDER_PATH]).toBe(END_REFLECTION_REMINDER_KNOWLEDGE);
    // 合成的 KnowledgeWindow 也应出现，source=protocol
    const kn = (out.contextWindows ?? []).find(
      (w) => w.type === "knowledge" && (w as { path?: string }).path === END_REFLECTION_REMINDER_PATH,
    );
    expect(kn).toBeDefined();
    expect((kn as { source?: string }).source).toBe("protocol");
  });

  it("does NOT inject when super flow opens end form (avoid recursive reminder)", async () => {
    const thread = makeThread({
      id: "t_end_super",
      persistence: {
        baseDir: "/tmp/test", sessionId: "super", objectId: "alice", threadId: "t_end_super",
      },
      extraWindows: [makeMethodExecWindow({ command: "end", id: "f_end" })],
    });
    const out = { knowledgeEntries: collectProtocolEntries(thread), contextWindows: buildProtocolKnowledgeWindows(thread) };
    expect(out.knowledgeEntries[END_REFLECTION_REMINDER_PATH]).toBeUndefined();
  });

  it("does NOT inject when business thread opens non-end form (e.g. talk)", async () => {
    const thread = makeThread({
      id: "t_talk_business",
      persistence: {
        baseDir: "/tmp/test", sessionId: "web-test", objectId: "alice", threadId: "t_talk_business",
      },
      extraWindows: [makeMethodExecWindow({ command: "talk", id: "f_talk" })],
    });
    const out = { knowledgeEntries: collectProtocolEntries(thread), contextWindows: buildProtocolKnowledgeWindows(thread) };
    expect(out.knowledgeEntries[END_REFLECTION_REMINDER_PATH]).toBeUndefined();
  });

  it("does NOT inject when business thread has no command_exec form", async () => {
    const thread = makeThread({
      id: "t_no_form",
      persistence: {
        baseDir: "/tmp/test", sessionId: "web-test", objectId: "alice", threadId: "t_no_form",
      },
    });
    const out = { knowledgeEntries: collectProtocolEntries(thread), contextWindows: buildProtocolKnowledgeWindows(thread) };
    expect(out.knowledgeEntries[END_REFLECTION_REMINDER_PATH]).toBeUndefined();
  });

  it("END_REFLECTION_REMINDER text contains key protocol elements", () => {
    // hint 设计要点：解释为什么 / 怎么做 / 什么时候不必 / 非强制
    expect(END_REFLECTION_REMINDER_KNOWLEDGE).toContain("endSummary");
    expect(END_REFLECTION_REMINDER_KNOWLEDGE).toContain("super");
    expect(END_REFLECTION_REMINDER_KNOWLEDGE).toContain('target: "super"');
    expect(END_REFLECTION_REMINDER_KNOWLEDGE).toContain("memory/<slug>.md");
    expect(END_REFLECTION_REMINDER_KNOWLEDGE).toContain("不必反思");
    expect(END_REFLECTION_REMINDER_KNOWLEDGE).toContain("hint");
    // 文本控制在 1800 字符内 (G3 调整: 拆 talk+say 两步 + 加 msg 好/坏例子后扩到 ~1600;
    // 每次 end form 才注入, 不在每轮上下文里, 1800 上限合理)
    expect(END_REFLECTION_REMINDER_KNOWLEDGE.length).toBeLessThan(1800);
  });
});
