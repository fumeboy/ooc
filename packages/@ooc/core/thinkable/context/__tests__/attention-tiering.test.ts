/**
 * 会话内容 attention 分层（2026-06-14）——第一公理「信息只渲一次」+ 用户拍板的分层：
 * - 与 thread **creator** 的对话（主要 attention）：全文走 LLM message 流；creator 窗在 context XML 只渲句柄。
 * - 与 **sub/peer** 窗的对话（次要 attention）：全文在该窗 XML transcript；message 流只出"新消息提示"（非全文）。
 */
import { describe, expect, it } from "bun:test";
import "@ooc/core/executable/windows"; // 注册窗类型
import { buildInputItems } from "../index";
import { makeThread } from "../../../__tests__/make-thread";
import type { ContextWindow } from "../../../executable/windows/_shared/types";

const CREATOR_WIN = {
  id: "w_creator", class: "talk", target: "user", isCreatorWindow: true,
  status: "open", createdAt: 1, title: "creator", conversationId: "w_creator",
} as unknown as ContextWindow;

const PEER_WIN = {
  id: "w_peer", class: "talk", target: "bob",
  status: "open", createdAt: 1, title: "peer bob", conversationId: "w_peer",
} as unknown as ContextWindow;

const CREATOR_FULL = "CREATOR_MESSAGE_FULL_TEXT_xyz";
const PEER_FULL = "PEER_MESSAGE_FULL_TEXT_xyz";

describe("会话内容 attention 分层", () => {
  it("creator 对话全文进 message 流、不在 context XML；peer 对话全文在 XML transcript、message 流只出提示", async () => {
    const thread = makeThread({
      id: "t",
      persistence: { baseDir: "/tmp/__ooc_tiering_test", sessionId: "s", objectId: "agent", threadId: "t" },
      extraWindows: [CREATOR_WIN, PEER_WIN],
    });
    thread.inbox = [
      { id: "m_creator", source: "user", content: CREATOR_FULL, replyToWindowId: "w_creator", fromThreadId: "root", toThreadId: "t", createdAt: 1 },
      { id: "m_peer", source: "talk", content: PEER_FULL, replyToWindowId: "w_peer", fromThreadId: "t_bob", toThreadId: "t", createdAt: 2 },
    ] as any;
    thread.events = [
      { category: "context_change", kind: "inbox_message_arrived", msgId: "m_creator" },
      { category: "context_change", kind: "inbox_message_arrived", msgId: "m_peer" },
    ] as any;

    const { input } = await buildInputItems(thread);
    const messageItems = input.filter((i) => i.type === "message") as Array<{ content: string }>;
    const ctxXml = messageItems.find((i) => i.content.startsWith("<context>"))!.content;
    const nonCtxStream = messageItems.filter((i) => !i.content.startsWith("<context>")).map((i) => i.content);

    // creator（主要 attention）：全文在 message 流、不在 context XML（窗是句柄）
    expect(nonCtxStream.some((c) => c.includes(CREATOR_FULL))).toBe(true);
    expect(ctxXml).not.toContain(CREATOR_FULL);
    // creator 窗渲句柄（含 transcript_in_messages 指引、不内联 transcript 正文）
    expect(ctxXml).toContain("transcript_in_messages");

    // peer（次要 attention）：全文在 context XML（窗 transcript）、不在 message 流
    expect(ctxXml).toContain(PEER_FULL);
    expect(nonCtxStream.some((c) => c.includes(PEER_FULL))).toBe(false);
    // message 流里有 peer 的"新消息提示"（指向窗、非全文）
    expect(nonCtxStream.some((c) => c.includes("m_peer") && c.includes("window_id=w_peer"))).toBe(true);
  });
});
