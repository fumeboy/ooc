import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import * as toolsModule from "../../executable/tools";
import { OPEN_TOOL } from "../../executable/tools/open";
import { SUBMIT_TOOL } from "../../executable/tools/submit";
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
      events: []
    };

    spyOn(toolsModule, "getAvailableTools").mockReturnValue([OPEN_TOOL, SUBMIT_TOOL]);

    spyOn(contextModule, "buildContext").mockImplementation(async (currentThread) => {
      const activeForm = currentThread.activeForms?.[0];

      if (!activeForm) {
        return [
          {
            role: "system",
            content: [
              "你是一个严格遵守工具调用要求的测试助手。",
              "本轮只允许调用一次 open 工具。",
              "请调用一次 open 工具，并且只调用这一次。",
              "参数必须等价于：type=\"command\"，command=\"end\"，description=\"结束线程\"，args={ reason: \"done\", summary: \"结束线程\" }。",
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
          content: `当前已经存在 form_id=${activeForm.formId} 的 end form。`
        }
      ];
    });

    await think(thread, client);
    expect(thread.activeForms).toHaveLength(1);
    expect(thread.activeForms?.[0]?.command).toBe("end");
    expect(thread.events.some((event) => event.kind === "tool_use" && event.toolName === "open")).toBe(true);
    expect(thread.status).toBe("running");
  }, 120000);
});
