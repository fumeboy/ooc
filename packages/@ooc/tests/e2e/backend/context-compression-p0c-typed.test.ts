/**
 * P0c — 4 个高频 ContextWindow type 的 compressView 验收 e2e。
 *
 * Design: docs/2026-05-25-context-compression-design.md §4.1
 * 任务说明: AgentOfThinkable P0c
 *
 * 覆盖：file_window / search_window / do_window / talk_window 四种 type 的自定义折叠态。
 * 每种 type 验证：
 *   1. Level 1 渲染包含该 type 的自定义节点(不是通用 fallback 的"未注册 compressView"提示)
 *   2. Level 2 渲染更精简(不含 Level 1 才有的预览/transcript 节点)
 *   3. expand 后渲染回完整 XML(出现原 renderXml 才有的标志性节点)
 *
 * 额外 case:
 *   - talk_window 截断 + 总数:构造 10 条消息,Level 1 后 XML 里只剩最近 2 条 + total_messages="10"
 *
 * 不走真 LLM:直接调 dispatchToolCall(compress) / dispatchToolCall(exec, command="expand")。
 */

import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { dispatchToolCall } from "@ooc/core/executable/tools";
import { makeThread } from "@ooc/core/__tests__/make-thread";
import { renderContextXml } from "@ooc/core/__tests__/render-context-xml";
import { generateWindowId } from "@ooc/core/executable/windows/_shared/types";
import type {
  DoWindow,
  FileWindow,
  SearchWindow,
  TalkWindow,
} from "@ooc/core/executable/windows/_shared/types";
import type { ThreadContext, ThreadMessage } from "@ooc/core/thinkable/context";

// 触发各 window type 的 side-effect 注册(compressView hook 需要这个)。
import "@ooc/core/executable/windows";

// ─────────────────────────────────────────────────────────────────────────────
// 通用 helpers
// ─────────────────────────────────────────────────────────────────────────────

/** 从完整 context XML 中切出指定 window 段。 */
function extractWindowSection(xml: string, windowId: string): string | undefined {
  const startMarker = `<window id="${windowId}"`;
  const startIdx = xml.indexOf(startMarker);
  if (startIdx < 0) return undefined;
  // 注意:窗口段内不会嵌套同 id 的 </window>,这里测试场景不构造跨级套娃,简单匹配即可。
  const endIdx = xml.indexOf("</window>", startIdx);
  if (endIdx < 0) return undefined;
  return xml.slice(startIdx, endIdx + "</window>".length);
}

/** 用 compress tool 把指定 window 切到 level。 */
async function compressWindow(
  thread: ThreadContext,
  windowId: string,
  level: 1 | 2,
  callId: string,
): Promise<void> {
  const out = await dispatchToolCall(thread, {
    id: callId,
    name: "compress",
    arguments: {
      scope: "windows",
      target_ids: [windowId],
      level,
      title: `fold ${windowId} to level=${level}`,
    },
  });
  const parsed = JSON.parse(out);
  expect(parsed.ok).toBe(true);
}

/** 用 exec(command="expand") 恢复 window。 */
async function expandWindow(
  thread: ThreadContext,
  windowId: string,
  callId: string,
): Promise<void> {
  const out = await dispatchToolCall(thread, {
    id: callId,
    name: "exec",
    arguments: {
      window_id: windowId,
      command: "expand",
      title: `expand ${windowId}`,
    },
  });
  const parsed = JSON.parse(out);
  expect(parsed.ok).toBe(true);
}

// ─────────────────────────────────────────────────────────────────────────────
// file_window
// ─────────────────────────────────────────────────────────────────────────────

describe("[p0c] file_window.compressView", () => {
  it("level=1 含 <file path total_lines read_range>; level=2 不含 read_range; expand 还原 <content>", async () => {
    const tmpRoot = mkdtempSync(join(tmpdir(), "ooc-p0c-file-"));
    const filePath = join(tmpRoot, "sample.txt");
    // 5 行内容
    writeFileSync(filePath, "alpha\nbeta\ngamma\ndelta\nepsilon\n", "utf8");
    try {
      const thread = makeThread();
      const fileWindowId = generateWindowId("file");
      const fileWindow: FileWindow = {
        id: fileWindowId,
        type: "file",
        title: "sample.txt",
        status: "open",
        createdAt: Date.now(),
        path: filePath,
        lines: [0, 3],
      };
      thread.contextWindows.push(fileWindow);

      // ── Level 1
      await compressWindow(thread, fileWindowId, 1, "call_file_l1");
      const xmlL1 = await renderContextXml({
        thread,
        contextWindows: thread.contextWindows,
      });
      const sectL1 = extractWindowSection(xmlL1, fileWindowId);
      expect(sectL1).toBeTruthy();
      // 自定义节点 <file path=... total_lines=... read_range=...>
      expect(sectL1).toContain(`<file `);
      expect(sectL1).toContain(`path="${filePath}"`);
      expect(sectL1).toContain(`total_lines=`);
      expect(sectL1).toContain(`read_range="0-3"`);
      // 标记
      expect(sectL1).toContain(`<compressed level="1"`);
      // 不应出现 fallback "未注册 compressView" 字样
      expect(sectL1).not.toContain("未注册 compressView");
      // 不应有完整 <content>
      expect(sectL1).not.toContain("<content>alpha");

      // ── Level 2
      await expandWindow(thread, fileWindowId, "call_file_l1_back");
      await compressWindow(thread, fileWindowId, 2, "call_file_l2");
      const xmlL2 = await renderContextXml({
        thread,
        contextWindows: thread.contextWindows,
      });
      const sectL2 = extractWindowSection(xmlL2, fileWindowId);
      expect(sectL2).toBeTruthy();
      expect(sectL2).toContain(`<file `);
      expect(sectL2).toContain(`total_lines=`);
      // Level 2 不再暴露 read_range
      expect(sectL2).not.toContain("read_range=");
      expect(sectL2).toContain(`<compressed level="2"`);

      // ── expand 还原
      await expandWindow(thread, fileWindowId, "call_file_l2_back");
      const xmlLive = await renderContextXml({
        thread,
        contextWindows: thread.contextWindows,
      });
      const sectLive = extractWindowSection(xmlLive, fileWindowId);
      expect(sectLive).toBeTruthy();
      // 完整渲染才有的 sentinel: <content> + 文件实际内容
      expect(sectLive).toContain("alpha");
      expect(sectLive).not.toContain("<compressed");
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// search_window
// ─────────────────────────────────────────────────────────────────────────────

describe("[p0c] search_window.compressView", () => {
  it("level=1 含 query + count + 前 3 条 preview; level=2 仅 query + count; expand 还原全部 matches", async () => {
    const thread = makeThread();
    const searchWindowId = generateWindowId("search");
    const matches = Array.from({ length: 5 }, (_, i) => ({
      index: i,
      path: `/tmp/file${i}.ts`,
      line: 10 + i,
      snippet: `hit-snippet-${i}`,
    }));
    const searchWindow: SearchWindow = {
      id: searchWindowId,
      type: "search",
      title: "grep 'foo'",
      status: "open",
      createdAt: Date.now(),
      kind: "grep",
      query: "foo",
      matches,
      truncated: false,
    };
    thread.contextWindows.push(searchWindow);

    // ── Level 1
    await compressWindow(thread, searchWindowId, 1, "call_search_l1");
    const xmlL1 = await renderContextXml({
      thread,
      contextWindows: thread.contextWindows,
    });
    const sectL1 = extractWindowSection(xmlL1, searchWindowId);
    expect(sectL1).toBeTruthy();
    expect(sectL1).toContain(`<query>foo</query>`);
    expect(sectL1).toContain(`count="5"`);
    // 前 3 条 preview 出现
    expect(sectL1).toContain(`<preview_list>`);
    expect(sectL1).toContain(`/tmp/file0.ts`);
    expect(sectL1).toContain(`/tmp/file1.ts`);
    expect(sectL1).toContain(`/tmp/file2.ts`);
    // 第 4/5 条不在
    expect(sectL1).not.toContain(`/tmp/file3.ts`);
    expect(sectL1).not.toContain(`/tmp/file4.ts`);
    expect(sectL1).toContain(`<compressed level="1"`);
    expect(sectL1).not.toContain("未注册 compressView");

    // ── Level 2
    await expandWindow(thread, searchWindowId, "call_search_l1_back");
    await compressWindow(thread, searchWindowId, 2, "call_search_l2");
    const xmlL2 = await renderContextXml({
      thread,
      contextWindows: thread.contextWindows,
    });
    const sectL2 = extractWindowSection(xmlL2, searchWindowId);
    expect(sectL2).toBeTruthy();
    expect(sectL2).toContain(`<query>foo</query>`);
    expect(sectL2).toContain(`count="5"`);
    // Level 2 不再有 preview_list
    expect(sectL2).not.toContain(`<preview_list>`);
    expect(sectL2).not.toContain(`/tmp/file0.ts`);
    expect(sectL2).toContain(`<compressed level="2"`);

    // ── expand 还原
    await expandWindow(thread, searchWindowId, "call_search_l2_back");
    const xmlLive = await renderContextXml({
      thread,
      contextWindows: thread.contextWindows,
    });
    const sectLive = extractWindowSection(xmlLive, searchWindowId);
    expect(sectLive).toBeTruthy();
    // 完整渲染才有的 sentinel: <matches count="5" ...> + 全部 5 条
    expect(sectLive).toContain(`/tmp/file0.ts`);
    expect(sectLive).toContain(`/tmp/file4.ts`);
    expect(sectLive).not.toContain("<compressed");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// do_window
// ─────────────────────────────────────────────────────────────────────────────

describe("[p0c] do_window.compressView", () => {
  it("level=1 含 target_thread + child_status + last_message + total_messages; level=2 不含 last_message", async () => {
    const thread = makeThread();
    const childThreadId = "t_child_001";
    const doWindowId = generateWindowId("do");
    const doWindow: DoWindow = {
      id: doWindowId,
      type: "do",
      title: "spawn helper",
      status: "running",
      createdAt: Date.now(),
      targetThreadId: childThreadId,
    };
    thread.contextWindows.push(doWindow);

    // 注入两条 transcript 消息(父 → 子,子 → 父),走 thread.outbox / thread.inbox
    const m1: ThreadMessage = {
      id: "m_do_1",
      fromThreadId: thread.id,
      toThreadId: childThreadId,
      content: "hello child",
      source: "user",
      createdAt: 1000,
    };
    const m2: ThreadMessage = {
      id: "m_do_2",
      fromThreadId: childThreadId,
      toThreadId: thread.id,
      content: "ack from child — last-do-message-sentinel",
      source: "user",
      createdAt: 2000,
    };
    thread.outbox = [m1];
    thread.inbox = [m2];

    // ── Level 1
    await compressWindow(thread, doWindowId, 1, "call_do_l1");
    const xmlL1 = await renderContextXml({
      thread,
      contextWindows: thread.contextWindows,
    });
    const sectL1 = extractWindowSection(xmlL1, doWindowId);
    expect(sectL1).toBeTruthy();
    expect(sectL1).toContain(`<target_thread>${childThreadId}</target_thread>`);
    expect(sectL1).toContain(`<child_status>running</child_status>`);
    expect(sectL1).toContain(`<total_messages>2</total_messages>`);
    expect(sectL1).toContain(`<last_message `);
    expect(sectL1).toContain(`last-do-message-sentinel`);
    expect(sectL1).toContain(`<compressed level="1"`);
    expect(sectL1).not.toContain("未注册 compressView");
    // 第一条不应出现(只保留最近一条)
    expect(sectL1).not.toContain("hello child");

    // ── Level 2
    await expandWindow(thread, doWindowId, "call_do_l1_back");
    await compressWindow(thread, doWindowId, 2, "call_do_l2");
    const xmlL2 = await renderContextXml({
      thread,
      contextWindows: thread.contextWindows,
    });
    const sectL2 = extractWindowSection(xmlL2, doWindowId);
    expect(sectL2).toBeTruthy();
    expect(sectL2).toContain(`<target_thread>${childThreadId}</target_thread>`);
    expect(sectL2).toContain(`<child_status>running</child_status>`);
    expect(sectL2).toContain(`<total_messages>2</total_messages>`);
    expect(sectL2).not.toContain(`<last_message`);
    expect(sectL2).not.toContain("last-do-message-sentinel");
    expect(sectL2).toContain(`<compressed level="2"`);

    // ── expand 还原
    await expandWindow(thread, doWindowId, "call_do_l2_back");
    const xmlLive = await renderContextXml({
      thread,
      contextWindows: thread.contextWindows,
    });
    const sectLive = extractWindowSection(xmlLive, doWindowId);
    expect(sectLive).toBeTruthy();
    // 完整渲染才有的 <transcript> 节点
    expect(sectLive).toContain(`<transcript>`);
    expect(sectLive).toContain("hello child");
    expect(sectLive).toContain("last-do-message-sentinel");
    expect(sectLive).not.toContain("<compressed");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// talk_window — 含截断 + 总数 case
// ─────────────────────────────────────────────────────────────────────────────

describe("[p0c] talk_window.compressView", () => {
  it("level=1 含 peer + total_messages + 最近 2 条 recent_messages; level=2 仅 peer + total; expand 还原 transcript", async () => {
    const thread = makeThread();
    const talkWindowId = generateWindowId("talk");
    const talkWindow: TalkWindow = {
      id: talkWindowId,
      type: "talk",
      title: "talk to peer_object",
      status: "open",
      createdAt: Date.now(),
      target: "peer_object",
      conversationId: talkWindowId,
    };
    thread.contextWindows.push(talkWindow);

    // 注入 10 条 talk_window 上的消息(走 outbox.windowId === self.id 路由)
    const messages: ThreadMessage[] = Array.from({ length: 10 }, (_, i) => ({
      id: `m_talk_${i}`,
      fromThreadId: thread.id,
      toThreadId: "t_peer_001",
      content: `talk-msg-${i}-content`,
      source: "user",
      createdAt: 1000 + i,
      windowId: talkWindowId,
    }));
    thread.outbox = messages;

    // ── Level 1
    await compressWindow(thread, talkWindowId, 1, "call_talk_l1");
    const xmlL1 = await renderContextXml({
      thread,
      contextWindows: thread.contextWindows,
    });
    const sectL1 = extractWindowSection(xmlL1, talkWindowId);
    expect(sectL1).toBeTruthy();
    expect(sectL1).toContain(`<peer>peer_object</peer>`);
    expect(sectL1).toContain(`<total_messages>10</total_messages>`);
    expect(sectL1).toContain(`<recent_messages count="2">`);
    // 仅最后 2 条 (index 8 / 9)
    expect(sectL1).toContain(`talk-msg-8-content`);
    expect(sectL1).toContain(`talk-msg-9-content`);
    // 前面 8 条不应出现
    expect(sectL1).not.toContain(`talk-msg-0-content`);
    expect(sectL1).not.toContain(`talk-msg-7-content`);
    expect(sectL1).toContain(`<compressed level="1"`);
    expect(sectL1).not.toContain("未注册 compressView");

    // ── Level 2
    await expandWindow(thread, talkWindowId, "call_talk_l1_back");
    await compressWindow(thread, talkWindowId, 2, "call_talk_l2");
    const xmlL2 = await renderContextXml({
      thread,
      contextWindows: thread.contextWindows,
    });
    const sectL2 = extractWindowSection(xmlL2, talkWindowId);
    expect(sectL2).toBeTruthy();
    expect(sectL2).toContain(`<peer>peer_object</peer>`);
    expect(sectL2).toContain(`<total_messages>10</total_messages>`);
    expect(sectL2).not.toContain(`<recent_messages`);
    expect(sectL2).not.toContain(`talk-msg-9-content`);
    expect(sectL2).toContain(`<compressed level="2"`);

    // ── expand 还原
    await expandWindow(thread, talkWindowId, "call_talk_l2_back");
    const xmlLive = await renderContextXml({
      thread,
      contextWindows: thread.contextWindows,
    });
    const sectLive = extractWindowSection(xmlLive, talkWindowId);
    expect(sectLive).toBeTruthy();
    // 完整渲染才有的 <transcript> + 全部 10 条
    expect(sectLive).toContain(`<transcript>`);
    expect(sectLive).toContain(`talk-msg-0-content`);
    expect(sectLive).toContain(`talk-msg-9-content`);
    expect(sectLive).not.toContain("<compressed");
  });

  it("level=1 单条消息超长时截断到 200 字", async () => {
    const thread = makeThread();
    const talkWindowId = generateWindowId("talk");
    const talkWindow: TalkWindow = {
      id: talkWindowId,
      type: "talk",
      title: "talk to peer_object",
      status: "open",
      createdAt: Date.now(),
      target: "peer_object",
      conversationId: talkWindowId,
    };
    thread.contextWindows.push(talkWindow);
    // 一条超长消息 (300 'A')
    const longContent = "A".repeat(300);
    const longMsg: ThreadMessage = {
      id: "m_talk_long",
      fromThreadId: thread.id,
      toThreadId: "t_peer_001",
      content: longContent,
      source: "user",
      createdAt: 1000,
      windowId: talkWindowId,
    };
    thread.outbox = [longMsg];

    await compressWindow(thread, talkWindowId, 1, "call_talk_trunc");
    const xml = await renderContextXml({
      thread,
      contextWindows: thread.contextWindows,
    });
    const sect = extractWindowSection(xml, talkWindowId);
    expect(sect).toBeTruthy();
    // 截断到 200 字: 应出现 200 个 A 不出现 300 个
    expect(sect).toContain("A".repeat(200));
    expect(sect).not.toContain("A".repeat(201));
  });
});
