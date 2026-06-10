/**
 * 集成测试：talk_window / do_window 上的 transcript viewport 协议。
 *
 * 覆盖：
 * - render 默认 tail=20：transcript ≤20 全展开；> 20 截到末 20 条，暴露 earlier_omitted
 * - set_transcript_window 命令：tail / range 模式切换、互斥、fail-loud
 * - 渲染时 <transcript_viewport> 元数据节点的属性正确性
 */
import { describe, expect, it, beforeAll } from "bun:test";

import "../index.js"; // 触发 registerObjectType 的 side-effect import

import { builtinRegistry } from "../_shared/registry.js";
import {
  ROOT_WINDOW_ID,
  type DoWindow,
  type TalkWindow,
} from "../_shared/types.js";
import { serializeXml } from "@ooc/core/_shared/types/xml.js";
import type { ThreadContext, ThreadMessage } from "../../../thinkable/context.js";

const NOW = 1_700_000_000_000;

function makeMessage(id: string, from: string, to: string, content: string, idx: number): ThreadMessage {
  return {
    id,
    fromThreadId: from,
    toThreadId: to,
    content,
    createdAt: NOW + idx,
    source: "talk",
  };
}

function makeThreadWithTalk(opts: {
  selfThreadId: string;
  talkWindow: TalkWindow;
  outboxMsgs?: ThreadMessage[];
  inboxMsgs?: ThreadMessage[];
}): ThreadContext {
  return {
    id: opts.selfThreadId,
    status: "running",
    events: [],
    contextWindows: [opts.talkWindow],
    inbox: opts.inboxMsgs ?? [],
    outbox: opts.outboxMsgs ?? [],
  };
}

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

describe("talk_window: transcript viewport render", () => {
  it("short transcript (< 20) renders fully + viewport meta with total + tail (no earlier_omitted)", async () => {
    const talkWindow: TalkWindow = {
      id: "w_talk_1",
      type: "talk",
      parentWindowId: ROOT_WINDOW_ID,
      title: "test",
      status: "open",
      createdAt: NOW,
      target: "bob",
      conversationId: "w_talk_1",
      state: { transcriptViewport: { tail: 20 } },
    };
    const outbox: ThreadMessage[] = Array.from({ length: 5 }, (_, i) => ({
      ...makeMessage(`m${i}`, "self", "bob", `msg ${i}`, i),
      windowId: "w_talk_1",
    }));
    const thread = makeThreadWithTalk({
      selfThreadId: "self",
      talkWindow,
      outboxMsgs: outbox,
    });
    const def = builtinRegistry.getObjectDefinition("talk");
    const nodes = await def.readable!({ thread, window: talkWindow });
    const xml = nodes.map((n) => serializeXml(n)).join("\n");
    expect(xml).toContain("<transcript_viewport");
    expect(xml).toContain('total="5"');
    expect(xml).toContain('tail="20"');
    expect(xml).not.toContain("earlier_omitted");
    // all 5 messages visible
    for (let i = 0; i < 5; i++) {
      expect(xml).toContain(`msg ${i}`);
    }
  });

  it("long transcript (> 20) clips to last 20 + earlier_omitted attribute", async () => {
    const talkWindow: TalkWindow = {
      id: "w_talk_2",
      type: "talk",
      parentWindowId: ROOT_WINDOW_ID,
      title: "test",
      status: "open",
      createdAt: NOW,
      target: "bob",
      conversationId: "w_talk_2",
      state: { transcriptViewport: { tail: 20 } },
    };
    const outbox: ThreadMessage[] = Array.from({ length: 30 }, (_, i) => ({
      ...makeMessage(`m${i}`, "self", "bob", `msg ${i}`, i),
      windowId: "w_talk_2",
    }));
    const thread = makeThreadWithTalk({
      selfThreadId: "self",
      talkWindow,
      outboxMsgs: outbox,
    });
    const def = builtinRegistry.getObjectDefinition("talk");
    const nodes = await def.readable!({ thread, window: talkWindow });
    const xml = nodes.map((n) => serializeXml(n)).join("\n");
    expect(xml).toContain('total="30"');
    expect(xml).toContain('tail="20"');
    expect(xml).toContain('earlier_omitted="10"');
    // first 10 hidden
    for (let i = 0; i < 10; i++) {
      expect(xml).not.toContain(`>msg ${i}<`);
    }
    // last 20 visible (10..29)
    for (let i = 10; i < 30; i++) {
      expect(xml).toContain(`msg ${i}`);
    }
  });

  it("render uses DEFAULT_TRANSCRIPT_VIEWPORT when window has no transcriptViewport (legacy data)", async () => {
    const talkWindow: TalkWindow = {
      id: "w_talk_legacy",
      type: "talk",
      parentWindowId: ROOT_WINDOW_ID,
      title: "test",
      status: "open",
      createdAt: NOW,
      target: "bob",
      conversationId: "w_talk_legacy",
      // no transcriptViewport
    };
    const outbox: ThreadMessage[] = Array.from({ length: 25 }, (_, i) => ({
      ...makeMessage(`m${i}`, "self", "bob", `msg ${i}`, i),
      windowId: "w_talk_legacy",
    }));
    const thread = makeThreadWithTalk({
      selfThreadId: "self",
      talkWindow,
      outboxMsgs: outbox,
    });
    const def = builtinRegistry.getObjectDefinition("talk");
    const nodes = await def.readable!({ thread, window: talkWindow });
    const xml = nodes.map((n) => serializeXml(n)).join("\n");
    expect(xml).toContain('tail="20"');
    expect(xml).toContain('earlier_omitted="5"');
  });

  it("range mode renders [rangeStart, rangeEnd) and exposes range attributes", async () => {
    const talkWindow: TalkWindow = {
      id: "w_talk_range",
      type: "talk",
      parentWindowId: ROOT_WINDOW_ID,
      title: "test",
      status: "open",
      createdAt: NOW,
      target: "bob",
      conversationId: "w_talk_range",
      state: { transcriptViewport: { rangeStart: 2, rangeEnd: 5 } },
    };
    const outbox: ThreadMessage[] = Array.from({ length: 10 }, (_, i) => ({
      ...makeMessage(`m${i}`, "self", "bob", `msg ${i}`, i),
      windowId: "w_talk_range",
    }));
    const thread = makeThreadWithTalk({
      selfThreadId: "self",
      talkWindow,
      outboxMsgs: outbox,
    });
    const def = builtinRegistry.getObjectDefinition("talk");
    const nodes = await def.readable!({ thread, window: talkWindow });
    const xml = nodes.map((n) => serializeXml(n)).join("\n");
    expect(xml).toContain('range_start="2"');
    expect(xml).toContain('range_end="5"');
    expect(xml).toContain('total="10"');
    expect(xml).toContain('earlier_omitted="2"');
    // visible 2..4
    expect(xml).toContain("msg 2");
    expect(xml).toContain("msg 3");
    expect(xml).toContain("msg 4");
    expect(xml).not.toContain(">msg 0<");
    expect(xml).not.toContain(">msg 5<");
  });
});

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
      state: { transcriptViewport: { tail: 20 } },
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
    const def = builtinRegistry.getObjectDefinition("do");
    const nodes = await def.readable!({ thread, window: doWindow });
    const xml = nodes.map((n) => serializeXml(n)).join("\n");
    expect(xml).toContain('total="25"');
    expect(xml).toContain('tail="20"');
    expect(xml).toContain('earlier_omitted="5"');
  });
});

describe("set_transcript_window windowMethod (talk)", () => {
  let setMethod: NonNullable<
    ReturnType<typeof builtinRegistry.getObjectDefinition>["windowMethods"]
  >[string];
  beforeAll(() => {
    setMethod = builtinRegistry.getObjectDefinition("talk").windowMethods!["set_transcript_window"]!;
    expect(setMethod).toBeDefined();
    expect(builtinRegistry.getObjectDefinition("talk").methods["set_transcript_window"]).toBeUndefined();
  });

  it("tail mode returns new state with transcriptViewport", () => {
    const out = setMethod.exec({
      args: { tail: 50 },
      windowState: { transcriptViewport: { tail: 20 } },
    } as any) as any;
    expect(out.ok).toBe(true);
    expect(out.state.transcriptViewport).toEqual({ tail: 50 });
  });

  it("range mode replaces tail", () => {
    const out = setMethod.exec({
      args: { range_start: 0, range_end: 10 },
      windowState: { transcriptViewport: { tail: 20 } },
    } as any) as any;
    expect(out.ok).toBe(true);
    expect(out.state.transcriptViewport).toEqual({ rangeStart: 0, rangeEnd: 10 });
  });

  it("does not mutate input windowState", () => {
    const windowState = { transcriptViewport: { tail: 20 } };
    setMethod.exec({ args: { tail: 50 }, windowState } as any);
    expect(windowState.transcriptViewport).toEqual({ tail: 20 });
  });

  it("fail-loud: tail + range_start mutually exclusive", () => {
    const out = setMethod.exec({
      args: { tail: 10, range_start: 0, range_end: 5 },
      windowState: { transcriptViewport: { tail: 20 } },
    } as any) as any;
    expect(out.ok).toBe(false);
    expect(out.error).toContain("互斥");
  });

  it("fail-loud: invalid tail", () => {
    const out = setMethod.exec({
      args: { tail: -5 },
      windowState: { transcriptViewport: { tail: 20 } },
    } as any) as any;
    expect(out.ok).toBe(false);
    expect(out.error).toContain("tail");
  });

  it("no viewport args returns ok with helpful result text", () => {
    const out = setMethod.exec({ args: {}, windowState: {} } as any) as any;
    expect(out.ok).toBe(true);
    expect(out.result).toContain("至少需要");
  });
});

describe("set_transcript_window windowMethod (do)", () => {
  it("works on do_window via shared helper", () => {
    const setMethod = builtinRegistry.getObjectDefinition("do").windowMethods!["set_transcript_window"]!;
    expect(setMethod).toBeDefined();
    expect(builtinRegistry.getObjectDefinition("do").methods["set_transcript_window"]).toBeUndefined();
    const out = setMethod.exec({
      args: { tail: 5 },
      windowState: { transcriptViewport: { tail: 20 } },
    } as any) as any;
    expect(out.ok).toBe(true);
    expect(out.state.transcriptViewport).toEqual({ tail: 5 });
  });
});
