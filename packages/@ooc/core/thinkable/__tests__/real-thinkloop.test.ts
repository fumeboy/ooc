import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import * as toolsModule from "../../executable/tools";
import { EXEC_TOOL } from "../../executable/tools/exec";
import { createLlmClient } from "../llm/client";
import * as contextModule from "../context";
import { think } from "../thinkloop";

// 真实测试优先读取当前工作区 .env，没有时回退到主仓库根目录 .env。
function loadRealEnv(): void {
  const envPaths = [resolve(process.cwd(), ".env"), resolve(process.cwd(), "../../.env")];

  for (const envPath of envPaths) {
    if (!existsSync(envPath)) continue;

    const content = readFileSync(envPath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      const separator = trimmed.indexOf("=");
      if (separator <= 0) continue;

      const key = trimmed.slice(0, separator);
      const value = trimmed.slice(separator + 1);
      process.env[key] = value;
    }
    return;
  }
}

afterEach(() => {
  mock.restore();
});

const shouldRunRealTest = process.env.RUN_REAL_THINKLOOP_TEST === "1";

describe.skipIf(!shouldRunRealTest)("real thinkloop integration", () => {
  it("使用真实模型跑通单轮 think 与 open tool call", async () => {
    loadRealEnv();
    process.env.OOC_PROVIDER = "openai";

    const client = createLlmClient();
    const thread: contextModule.ThreadContext = {
      id: "real-thinkloop",
      status: "running",
      events: [],
      contextWindows: []
    };

    spyOn(toolsModule, "getAvailableTools").mockReturnValue([EXEC_TOOL]);

    spyOn(contextModule, "buildContext").mockImplementation(async (currentThread) => {
      const activeForm = currentThread.contextWindows.find((w) => w.type === "method_exec");

      if (!activeForm || activeForm.type !== "method_exec") {
        return [
          {
            role: "system",
            content: [
              "你是一个严格遵守工具调用要求的测试助手。",
              "本轮只允许调用一次 open 工具。",
              "请调用一次 open 工具，并且只调用这一次。",
              "参数必须等价于：command=\"end\", title=\"结束线程\", args={ reason: \"done\", summary: \"结束线程\" }。",
              "不要输出任何多余解释。"
            ].join("\n")
          },
          {
            role: "user",
            content: "请先打开 end command form。"
          }
        ];
      }

      return [
        {
          role: "system",
          content: `当前已经存在 form_id=${activeForm.id} 的 end form。`
        }
      ];
    });

    await think(thread, client);
    const formsAfter = thread.contextWindows.filter((w) => w.type === "method_exec");
    // end 命令在 args 给齐时 open 可能直接提交 form；这里只验证 think 跑过、且没崩
    expect(thread.events.some((event) => event.kind === "tool_use" && event.toolName === "exec")).toBe(true);
    void formsAfter;
    expect(["running", "done"]).toContain(thread.status);
  }, 120000);
});
