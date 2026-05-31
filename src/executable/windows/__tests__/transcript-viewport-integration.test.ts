/**
 * 集成测试：do_window 上的 transcript viewport 协议。
 *
 * 覆盖：
 * - render 默认 tail=20：transcript > 20 截到末 20 条，暴露 earlier_omitted
 * - set_transcript_window 命令（do）：tail 模式更新 window.transcriptViewport
 *
 * OOC-4 L5c：talk_window 的 say/wait/close/set_transcript_window 方法 + renderXml 已下线
 * （agent 经 <self_view><talks> 自视切片看会话），故本文件只保留 do_window 的 transcript 协议覆盖。
 */
import { describe, expect, it } from "bun:test";

import "../index.js"; // 触发 registerWindowType 的 side-effect import

import { getWindowTypeDefinition } from "../_shared/registry.js";
import {
  ROOT_WINDOW_ID,
  type DoWindow,
} from "../_shared/types.js";
import { serializeXml } from "../../../thinkable/context/xml.js";
import type { ThreadContext, ThreadMessage } from "../../../thinkable/context.js";

const NOW = 1_700_000_000_000;

function makeThreadWithDo(opts: {
  selfThreadId: string;
  doWindow: DoWindow;
  outboxMsgs?: ThreadMessage[];
  inboxMsgs?: ThreadMessage[];
}): ThreadContext {
  return {
    id: opts.selfThreadId,
    status: "running",
    events: [],
    contextWindows: [opts.doWindow],
    inbox: opts.inboxMsgs ?? [],
    outbox: opts.outboxMsgs ?? [],
  };
}

describe("do_window: transcript viewport render", () => {
  it("long transcript clips to last 20", async () => {
    const doWindow: DoWindow = {
      id: "w_do_1",
      type: "do",
      parentWindowId: ROOT_WINDOW_ID,
      title: "test",
      status: "running",
      createdAt: NOW,
      targetThreadId: "child1",
      transcriptViewport: { tail: 20 },
    };
    const outbox: ThreadMessage[] = Array.from({ length: 25 }, (_, i) => ({
      id: `m${i}`,
      fromThreadId: "self",
      toThreadId: "child1",
      content: `do-msg ${i}`,
      createdAt: NOW + i,
      source: "do",
    }));
    const thread = makeThreadWithDo({
      selfThreadId: "self",
      doWindow,
      outboxMsgs: outbox,
    });
    const def = getWindowTypeDefinition("do");
    const nodes = await def.renderXml!({ thread, window: doWindow });
    const xml = nodes.map((n) => serializeXml(n)).join("\n");
    expect(xml).toContain('total="25"');
    expect(xml).toContain('tail="20"');
    expect(xml).toContain('earlier_omitted="5"');
  });
});

describe("set_transcript_window command (do)", () => {
  it("works on do_window via shared helper", async () => {
    const setCommand = getWindowTypeDefinition("do").methods["set_transcript_window"]!;
    expect(setCommand).toBeDefined();
    const doWindow: DoWindow = {
      id: "w_do_set",
      type: "do",
      parentWindowId: ROOT_WINDOW_ID,
      title: "test",
      status: "running",
      createdAt: NOW,
      targetThreadId: "child",
      transcriptViewport: { tail: 20 },
    };
    const out = await setCommand.exec({
      args: { tail: 5 },
      parentWindow: doWindow,
    });
    expect(out).toBeUndefined();
    expect(doWindow.transcriptViewport).toEqual({ tail: 5 });
  });
});
