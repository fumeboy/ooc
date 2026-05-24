/**
 * Reflectable knowledge protocol injection — spec 2026-05-18 super-flow-channel.
 *
 * 验证：collectExecutableKnowledgeEntries 仅在 thread.persistence.sessionId
 * === "super" 时注入 REFLECTABLE knowledge entry。
 */
import { describe, expect, it } from "bun:test";
import { collectExecutableKnowledgeEntries } from "../../executable/index";
import {
  REFLECTABLE_BASIC_PATH,
  REFLECTABLE_KNOWLEDGE,
  REFLECTABLE_METAPROG_KNOWLEDGE,
  REFLECTABLE_METAPROG_PATH,
} from "./reflectable-knowledge";
import { makeThread } from "../../__tests__/make-thread";

describe("reflectable knowledge protocol injection", () => {
  it("injects REFLECTABLE entry when sessionId === 'super'", async () => {
    const thread = makeThread({
      id: "t_super_alice",
      persistence: {
        baseDir: "/tmp/test", sessionId: "super", objectId: "alice", threadId: "t_super_alice",
      },
    });
    const out = await collectExecutableKnowledgeEntries(thread.contextWindows, thread);
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
    const out = await collectExecutableKnowledgeEntries(thread.contextWindows, thread);
    expect(out.knowledgeEntries[REFLECTABLE_BASIC_PATH]).toBeUndefined();
    expect(out.knowledgeEntries[REFLECTABLE_METAPROG_PATH]).toBeUndefined();
  });

  it("does NOT inject when thread has no persistence (in-memory mode)", async () => {
    const thread = makeThread({ id: "t_in_memory" });
    const out = await collectExecutableKnowledgeEntries(thread.contextWindows, thread);
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
    expect(REFLECTABLE_KNOWLEDGE).toContain("show_description_when");
    expect(REFLECTABLE_KNOWLEDGE).toContain("show_content_when");
    // 强调"没有 frontmatter = silently 失效"
    expect(REFLECTABLE_KNOWLEDGE).toMatch(/永远无法激活|永远无法被|断裂/);
    // 完整模板 fence
    expect(REFLECTABLE_KNOWLEDGE).toMatch(/```markdown[\s\S]*---[\s\S]*activates_on[\s\S]*---[\s\S]*```/);
  });
});
