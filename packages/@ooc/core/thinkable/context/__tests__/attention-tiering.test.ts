/**
 * 会话内容 attention 分层（2026-06-14）——第一公理「信息只渲一次」+ 用户拍板的分层：
 * - 与 thread **creator** 的对话（主要 attention）：全文走 LLM message 流；creator 窗在 context XML 只渲句柄。
 * - 与 **sub/peer** 窗的对话（次要 attention）：全文在该窗 XML transcript；message 流只出"新消息提示"（非全文）。
 */
import { describe, expect, it } from "bun:test";
import "@ooc/core/runtime/register-builtins.js"; // 注册窗类型
import { buildInputItems } from "../index";
import { makeThread } from "../../../__tests__/make-thread";
import type { ContextWindow } from "@ooc/core/_shared/types/context-window.js";

// Wave4 会话窗：stored class=_builtin/agent/thread；creator 身份编码在 id（w_creator_<threadId>）；
// target / isForkWindow / targetThreadId 落 inst.data（talk-render 读 self.* = inst.data）。
const CREATOR_WIN = {
  id: "w_creator_t", class: "_builtin/agent/thread",
  status: "open", createdAt: 1, title: "creator", data: { target: "user" },
} as unknown as ContextWindow;

const PEER_WIN = {
  id: "w_peer", class: "_builtin/agent/thread",
  status: "open", createdAt: 1, title: "peer bob", data: { target: "bob" },
} as unknown as ContextWindow;

const CREATOR_FULL = "CREATOR_MESSAGE_FULL_TEXT_xyz";
// >50 字，确保次要窗的 message 流缩略只含前 50 字预览、不含全文尾部 sentinel。
const PEER_FULL = "PEER_HEAD_0123456789_0123456789_0123456789_0123456789_PEER_TAIL_SENTINEL";
const PEER_TAIL = "PEER_TAIL_SENTINEL"; // 仅出现在全文(>50 字处)，用于断言"全文不在 message 流"

describe("会话内容 attention 分层", () => {
  // SKIP（real bug，非测试 stale）：窗形态已迁到 Wave4 对象模型（class=_builtin/agent/thread + data.*），
  // creator 句柄化 / peer transcript / message 流缩略提示均已正确产出。但断言「creator 全文不在
  // context XML」「peer 全文尾部不在 message 流」失败，根因是**顶层 inbox 未对「已被窗 transcript /
  // message 流消费的消息」去重**：renderers/xml.ts:397 `renderMessagesNode("inbox", thread.inbox)`
  // 直渲全量 inbox（注释自称「本层只兜未消费」但无实际过滤），违反 context.md 核心 10「信息只渲一次」
  // + 设计契约 line 137「本窗消费了哪些消息（供 attention 分流去重）」。待 thinkable-context 维度修
  // 顶层 inbox 消费去重后解封。
  it("creator 对话全文进 message 流、不在 context XML；peer 对话全文在 XML transcript、message 流只出提示", async () => {
    const thread = makeThread({
      id: "t",
      persistence: { baseDir: "/tmp/__ooc_tiering_test", sessionId: "s", objectId: "agent", threadId: "t" },
      extraWindows: [CREATOR_WIN, PEER_WIN],
    });
    thread.inbox = [
      { id: "m_creator", source: "user", content: CREATOR_FULL, replyToWindowId: "w_creator_t", fromThreadId: "root", toThreadId: "t", createdAt: 1 },
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

    // peer（次要 attention）：全文在 context XML（窗 transcript）；message 流只出缩略提示（前 50 字预览，不含全文尾部）
    expect(ctxXml).toContain(PEER_FULL);
    expect(nonCtxStream.some((c) => c.includes(PEER_TAIL))).toBe(false); // 全文尾部(>50 字处)不进 message 流
    // message 流里有 peer 的"新消息提示"：指向窗 + 前 50 字预览
    expect(nonCtxStream.some((c) => c.includes("window_id=w_peer") && c.includes("收到新消息") && c.includes("PEER_HEAD"))).toBe(true);
  });

  // SKIP（同一 real bug：顶层 inbox 消费去重缺失）：parent 指令全文同时出现在 message 流 + 顶层 inbox，
  // `ctxXml not.toContain(PARENT_FULL)` 失败。窗形态已迁 Wave4；待顶层 inbox 去重修复后解封。
  it("通用性（非 user 特例）：creator 是 parent thread（fork 子窗）时同样句柄化、parent 对话进 message 流", async () => {
    // fork 子线程视角：它的 creator 窗是 fork 子窗（id=w_creator_<本thread.id>），
    // data.target=self object、data.targetThreadId=parent thread、data.isForkWindow=true。
    const FORK_CREATOR = {
      id: "w_creator_t_child", class: "_builtin/agent/thread",
      status: "open", createdAt: 1, title: "creator fork",
      data: { target: "agent", targetThreadId: "t_parent", isForkWindow: true },
    } as unknown as ContextWindow;
    const PARENT_FULL = "PARENT_INSTRUCTION_FULL_TEXT_xyz";
    const thread = makeThread({
      id: "t_child",
      persistence: { baseDir: "/tmp/__ooc_tiering_test2", sessionId: "s", objectId: "agent", threadId: "t_child" },
      extraWindows: [FORK_CREATOR],
    });
    thread.inbox = [
      { id: "m_parent", source: "talk", content: PARENT_FULL, replyToWindowId: "w_creator_t_child", fromThreadId: "t_parent", toThreadId: "t_child", createdAt: 1 },
    ] as any;
    thread.events = [
      { category: "context_change", kind: "inbox_message_arrived", msgId: "m_parent" },
    ] as any;

    const { input } = await buildInputItems(thread);
    const messageItems = input.filter((i) => i.type === "message") as Array<{ content: string }>;
    const ctxXml = messageItems.find((i) => i.content.startsWith("<context>"))!.content;
    const nonCtxStream = messageItems.filter((i) => !i.content.startsWith("<context>")).map((i) => i.content);

    // creator 是 parent thread（fork 子窗），仍句柄化：parent 指令全文进 message 流、creator 窗不内联 transcript
    expect(nonCtxStream.some((c) => c.includes(PARENT_FULL))).toBe(true);
    expect(ctxXml).not.toContain(PARENT_FULL);
    expect(ctxXml).toContain("transcript_in_messages"); // creator 窗=句柄（判据是 isCreatorWindow，与 target 无关）
  });
});
