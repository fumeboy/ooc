import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { formatThread } from "../formatter";
import { TuiBlock } from "./TuiBlock";

describe("TuiBlock tool cards", () => {
  it("renders tool card collapsed by default with status and expand control in header", () => {
    const lines = formatThread({
      id: "thread_1",
      status: "running",
      events: [
        {
          category: "llm_interaction",
          kind: "function_call",
          callId: "call_refine_1",
          toolName: "refine",
          arguments: {
            title: "补充回复内容",
            form_id: "f_mp4bfm0c_9k1c",
            form_args: {
              msg: "你好，我可以帮你做什么？",
              tone: "friendly",
            },
            mark: [
              {
                messageId: "msg_1",
                type: "ack",
                tip: "已回复用户问候",
              },
            ],
          },
        },
        {
          category: "tool_runtime",
          kind: "function_call_output",
          callId: "call_refine_1",
          toolName: "refine",
          ok: true,
          output: JSON.stringify({
            ok: true,
            tool: "refine",
            message: "[refine] Form f_mp4bfm0c_9k1c 已累积参数。",
          }),
        },
      ],
    });

    const line = lines[0];
    expect(line?.kind).toBe("tool");

    const html = renderToStaticMarkup(<TuiBlock line={line!} />);

    expect(html).toContain("补充回复内容");
    expect(html).toContain("refine");
    expect(html).toContain("tui-tool-card-toggle");
    expect(html).toContain("tui-tool-status is-success");
    expect(html).toContain('<span class="tui-label">refine</span>');
    expect(html).not.toContain('<span class="tui-label">tool</span>');
    expect(html).not.toContain("call_refine_1");

    const headerIndex = html.indexOf("tui-tool-shell-head");
    const statusIndex = html.indexOf("tui-tool-status");
    expect(headerIndex).toBeGreaterThan(-1);
    expect(statusIndex).toBeGreaterThan(headerIndex);

    expect(html).not.toContain("tui-tool-body");
    expect(html).not.toContain("tui-tool-footer");
    // 2026-05-20: 用户反馈后, link 按钮被提到 head 行 (折叠也能跳到 ContextTree),
    // 所以 head 行 title attr 含 form_id 是预期的; 但 body / footer / argumentsText 中
    // 详细参数依然不应出现.
    expect(html).not.toContain("你好，我可以帮你做什么？");
    expect(html).not.toContain("friendly");
    expect(html).not.toContain("marks");
    expect(html).not.toContain("arguments");
    expect(html).not.toContain("output");
    expect(html).not.toContain("tui-copy");
    expect(html).not.toContain("tui-tool-fields");
    expect(html).not.toContain('"form_args"');
    expect(html).not.toContain('"messageId"');
    expect(html).not.toContain('"tool": "refine"');
  });

  it("shows human-readable description and reason in the collapsed header", () => {
    const lines = formatThread({
      id: "thread_2",
      status: "running",
      events: [
        {
          category: "llm_interaction",
          kind: "function_call",
          callId: "call_open_1",
          toolName: "open",
          arguments: {
            title: "回复问候",
            type: "command",
            command: "talk",
            description: "向用户回复问候",
          },
        },
        {
          category: "tool_runtime",
          kind: "function_call_output",
          callId: "call_open_1",
          toolName: "open",
          ok: true,
          output: JSON.stringify({ ok: true, tool: "open" }),
        },
        {
          category: "llm_interaction",
          kind: "function_call",
          callId: "call_wait_1",
          toolName: "wait",
          arguments: {
            title: "等待用户补充",
            reason: "等待用户提出具体需求",
          },
        },
      ],
    });

    const openHtml = renderToStaticMarkup(<TuiBlock line={lines[0]!} />);
    const waitHtml = renderToStaticMarkup(<TuiBlock line={lines[1]!} />);

    expect(openHtml).toContain("回复问候");
    expect(openHtml).toContain("向用户回复问候");
    expect(openHtml).toContain("tui-tool-head-row tui-tool-head-row-main");
    expect(openHtml).toContain("tui-tool-head-row tui-tool-head-row-sub");
    expect(openHtml).not.toContain("tui-tool-body");
    expect(openHtml).not.toContain("COMMAND");

    expect(waitHtml).toContain("等待用户补充");
    expect(waitHtml).toContain("等待用户提出具体需求");
    expect(waitHtml).not.toContain("tui-tool-body");
    expect(waitHtml).not.toContain("REASON");
  });

  it("pairs parallel tool_calls with their non-adjacent function_call_output by callId", () => {
    // LLM 一次抛多个 tool_call 时，事件序列是 call1, call2, output1, output2；
    // formatter 必须按 callId 配对而不是按相邻顺序。
    const lines = formatThread({
      id: "thread_parallel",
      status: "running",
      events: [
        {
          category: "llm_interaction",
          kind: "function_call",
          callId: "call_open_idx",
          toolName: "open",
          arguments: { title: "读取 index.doc.js" },
        },
        {
          category: "llm_interaction",
          kind: "function_call",
          callId: "call_open_iter",
          toolName: "open",
          arguments: { title: "读取 iteration.doc.js" },
        },
        {
          category: "tool_runtime",
          kind: "function_call_output",
          callId: "call_open_idx",
          toolName: "open",
          ok: true,
          output: JSON.stringify({ ok: true, tool: "open" }),
        },
        {
          category: "tool_runtime",
          kind: "function_call_output",
          callId: "call_open_iter",
          toolName: "open",
          ok: true,
          output: JSON.stringify({ ok: true, tool: "open" }),
        },
      ],
    });

    expect(lines).toHaveLength(2);
    const [first, second] = lines as Array<Extract<(typeof lines)[number], { kind: "tool" }>>;
    expect(first.kind).toBe("tool");
    expect(first.callId).toBe("call_open_idx");
    expect(first.pending).toBe(false);
    expect(first.ok).toBe(true);
    expect(first.title).toBe("读取 index.doc.js");

    expect(second.kind).toBe("tool");
    expect(second.callId).toBe("call_open_iter");
    expect(second.pending).toBe(false);
    expect(second.ok).toBe(true);
    expect(second.title).toBe("读取 iteration.doc.js");
  });

  it("uses distinct icons for open, refine, submit, close, and wait tool cards", () => {
    const toolCases = [
      ["open", "lucide-folder-plus"],
      ["refine", "lucide-sliders-horizontal"],
      ["submit", "lucide-send-horizontal"],
      ["close", "lucide-circle-x"],
      ["wait", "lucide-clock3"],
    ] as const;

    for (const [toolName, iconClass] of toolCases) {
      const lines = formatThread({
        id: `thread_${toolName}`,
        status: "running",
        events: [
          {
            category: "llm_interaction",
            kind: "function_call",
            callId: `call_${toolName}`,
            toolName,
            arguments: {
              title: `${toolName} title`,
            },
          },
        ],
      });

      const html = renderToStaticMarkup(<TuiBlock line={lines[0]!} />);
      expect(html).toContain(iconClass);
    }
  });
});
