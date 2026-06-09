/**
 * relation_window — 单元测试
 *
 * 覆盖 spec 2026-05-20 relation-window-design 中 executeRelationEdit 的:
 *   - scope="session"   → 落到 flow 层文件
 *   - scope="long_term" → 派 talk message 给 super(新建 / 复用 super talk_window)
 *   - 参数校验失败 / parent 类型错误 → 返回 error 文本而不 throw
 *
 * 复用 talk-delivery.test.ts 的 fixture 风格(真 fs / 真 deliverTalkMessage)。
 */
import { mkdtemp, readFile as fsReadFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "bun:test";
import {
  createFlowObject,
  createFlowSession,
  createStoneObject,
  flowRelationFile,
  writeThread,
} from "../../../persistable";
import { executeRelationEdit } from "../relation";
import { SUPER_ALIAS_TARGET, SUPER_SESSION_ID } from "../_shared/super-constants";
import { initContextWindows } from "../_shared/init";
import { ROOT_WINDOW_ID, type RelationWindow, type TalkWindow } from "../_shared/types";
import type { ThreadContext } from "../../../thinkable/context";
import type { MethodExecutionContext } from "../_shared/method-types";

const SELF = "alice";
const PEER = "critic";
const SID = "web-test";

async function setupSelfThread(baseDir: string, opts: { withSuperTalk?: TalkWindow } = {}) {
  await createFlowSession(baseDir, SID);
  await createStoneObject({ baseDir, objectId: SELF });
  await createStoneObject({ baseDir, objectId: PEER });
  const flow = await createFlowObject({ baseDir, sessionId: SID, objectId: SELF });
  const relationWindow: RelationWindow = {
    id: `w_rel_${PEER}`,
    type: "relation",
    parentWindowId: ROOT_WINDOW_ID,
    title: `relation: ${PEER}`,
    status: "open",
    createdAt: Date.now(),
    peerId: PEER,
    // 2026-05-27: peer_readme 撤回 R8-5 删除决定;default visibility 需要 peer 身份介绍
    peerReadmePath: `stones/main/objects/${PEER}/readme.md`,
    peerReadmeExists: false,
    selfLongTermPath: `pools/${SELF}/knowledge/relations/${PEER}.md`,
    selfLongTermExists: false,
    selfSessionPath: `flows/${SID}/objects/${SELF}/knowledge/relations/${PEER}.md`,
    selfSessionExists: false,
  };
  const thread: ThreadContext = {
    id: "t_root",
    status: "running",
    events: [],
    contextWindows: [],
    persistence: { ...flow, threadId: "t_root" },
  };
  initContextWindows(thread, { initialTaskTitle: "test self" });
  thread.contextWindows = [...thread.contextWindows, relationWindow];
  if (opts.withSuperTalk) {
    thread.contextWindows = [...thread.contextWindows, opts.withSuperTalk];
  }
  await writeThread(thread);
  return { thread, relationWindow };
}

function execCtx(thread: ThreadContext, parent: RelationWindow, args: Record<string, unknown>): MethodExecutionContext {
  return { thread, self: parent, args };
}

describe("executeRelationEdit", () => {
  it("scope='session' → 写入 flow 层 relation 文件", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "ooc-rel-edit-"));
    try {
      const { thread, relationWindow } = await setupSelfThread(tempRoot);
      const content = "## 偏好\n- 简短回复\n";
      const result = await executeRelationEdit(
        execCtx(thread, relationWindow, { content, scope: "session" }),
      );
      expect(typeof result).toBe("string");
      expect(result).toContain("session 层 relation");
      const file = flowRelationFile({ baseDir: tempRoot, sessionId: SID, objectId: SELF }, PEER);
      expect(existsSync(file)).toBe(true);
      const written = await fsReadFile(file, "utf8");
      expect(written).toBe(content);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("scope='long_term' 且无 super talk_window → 创建 super session + callee + caller.outbox 多出消息", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "ooc-rel-edit-"));
    try {
      const { thread, relationWindow } = await setupSelfThread(tempRoot);
      const outboxBefore = thread.outbox?.length ?? 0;
      const content = "稳定合作模式:简短 / 不要 emoji";
      const result = await executeRelationEdit(
        execCtx(thread, relationWindow, { content, scope: "long_term" }),
      );
      expect(typeof result).toBe("string");
      expect(result).toContain("long_term");
      expect(result).toContain("super flow");
      // caller outbox 多了一条
      expect((thread.outbox?.length ?? 0)).toBe(outboxBefore + 1);
      const sentMsg = thread.outbox![thread.outbox!.length - 1]!;
      expect(sentMsg.content).toContain(PEER);
      expect(sentMsg.content).toContain(content);
      // super session metadata 已创建
      expect(existsSync(join(tempRoot, "flows", SUPER_SESSION_ID, ".session.json"))).toBe(true);
      // super flow 的 callee 目录已创建
      const superSelfDir = join(tempRoot, "flows", SUPER_SESSION_ID, "objects", SELF, "threads");
      expect(existsSync(superSelfDir)).toBe(true);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("scope='long_term' 且已有 super talk_window → 复用其 id,thread 不多挂临时 window", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "ooc-rel-edit-"));
    try {
      const superTalk: TalkWindow = {
        id: "w_talk_super_existing",
        type: "talk",
        parentWindowId: ROOT_WINDOW_ID,
        title: "talk to super",
        status: "open",
        createdAt: Date.now(),
        target: SUPER_ALIAS_TARGET,
        conversationId: "w_talk_super_existing",
      };
      const { thread, relationWindow } = await setupSelfThread(tempRoot, { withSuperTalk: superTalk });
      const beforeIds = (thread.contextWindows ?? []).map((w) => w.id).sort();
      const result = await executeRelationEdit(
        execCtx(thread, relationWindow, { content: "x", scope: "long_term" }),
      );
      expect(result).toContain("long_term");
      // contextWindows 不应该多出临时 talk_window —— super talk_window 被复用
      const afterIds = (thread.contextWindows ?? []).map((w) => w.id).sort();
      expect(afterIds).toEqual(beforeIds);
      // caller outbox 这条消息的 windowId 应该是复用的 super talk_window id
      const lastOut = thread.outbox![thread.outbox!.length - 1]!;
      expect(lastOut.windowId).toBe("w_talk_super_existing");
      // 该 super talk_window 的 targetThreadId 被回填
      const updatedSuperTalk = thread.contextWindows!.find((w) => w.id === "w_talk_super_existing") as TalkWindow;
      expect(updatedSuperTalk.targetThreadId).toBeDefined();
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("缺 content → 返回 error 文本,不 throw", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "ooc-rel-edit-"));
    try {
      const { thread, relationWindow } = await setupSelfThread(tempRoot);
      const result = await executeRelationEdit(
        execCtx(thread, relationWindow, { scope: "session" }),
      );
      expect(typeof result).toBe("string");
      expect(result).toContain("[relation.edit]");
      expect(result).toContain("content");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("缺 scope → 返回 error 文本", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "ooc-rel-edit-"));
    try {
      const { thread, relationWindow } = await setupSelfThread(tempRoot);
      const result = await executeRelationEdit(
        execCtx(thread, relationWindow, { content: "x" }),
      );
      expect(result).toContain("scope");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("非法 scope → 返回 error 文本", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "ooc-rel-edit-"));
    try {
      const { thread, relationWindow } = await setupSelfThread(tempRoot);
      const result = await executeRelationEdit(
        execCtx(thread, relationWindow, { content: "x", scope: "invalid" }),
      );
      expect(result).toContain("scope");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  // P6.§3 (2026-06-02): self-type guard 已下放到 manager.submit；method 体不再 re-check
  // self.type === "relation_window"。旧测试 "parent window 不是 relation 类型" 已删除，
  // 跨类型拒绝由 manager-dispatch 测试覆盖（见 manager-method-dispatch.test.ts）。

  it("缺 thread → 返回 error 文本", async () => {
    const result = await executeRelationEdit({ args: { content: "x", scope: "session" } });
    expect(result).toContain("缺少 thread context");
  });
});
