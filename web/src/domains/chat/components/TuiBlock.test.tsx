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
    expect(html).not.toContain("f_mp4bfm0c_9k1c");
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
