/**
 * Reflectable knowledge protocol injection — spec 2026-05-18 super-flow-channel.
 *
 * 验证：collectExecutableKnowledgeEntries 仅在 thread.persistence.sessionId
 * === "super" 时注入 REFLECTABLE knowledge entry。
 */
import { describe, expect, it } from "bun:test";
import { collectExecutableKnowledgeEntries } from "../../executable/index";
import { REFLECTABLE_BASIC_PATH, REFLECTABLE_KNOWLEDGE } from "./reflectable-knowledge";
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
    // 同时检查合成的 KnowledgeWindow 出现
    const kn = (out.contextWindows ?? []).find(
      (w) => w.type === "knowledge" && (w as { path?: string }).path === REFLECTABLE_BASIC_PATH,
    );
    expect(kn).toBeDefined();
    expect((kn as { source?: string }).source).toBe("protocol");
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
  });

  it("does NOT inject when thread has no persistence (in-memory mode)", async () => {
    const thread = makeThread({ id: "t_in_memory" });
    const out = await collectExecutableKnowledgeEntries(thread.contextWindows, thread);
    expect(out.knowledgeEntries[REFLECTABLE_BASIC_PATH]).toBeUndefined();
  });
});
