/**
 * D1 修复验证测试
 *
 * Bruce 发现 TRAIT.md 文档承诺 close 后的 inject 会列出卸载的 trait，
 * 实测 close 一个 talk form 后 inject 消息格式不包含 [close] 前缀，
 * 也没有专门针对文件类型 form 的"文件已从上下文窗口移除"提示。
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

import { runWithThreadTree, type EngineConfig } from "../src/thinkable/engine/engine.js";
import { MockLLMClient, type ToolCall } from "../src/thinkable/llm/client.js";
import type { StoneData } from "../src/shared/types/index.js";
import { eventBus } from "../src/observable/server/events.js";
import type { ThreadAction } from "../src/thinkable/thread-tree/types.js";

const TEST_DIR = join(import.meta.dir, ".tmp_close_inject_test");
const FLOWS_DIR = join(TEST_DIR, "flows");

function makeStone(name: string): StoneData {
  return {
    name,
    thinkable: { whoAmI: `${name}` },
    talkable: { whoAmI: `${name}`, functions: [] },
    data: {},
    relations: [],
    traits: [],
  };
}

function toolCall(name: string, args: Record<string, unknown>): ToolCall {
  return {
    id: `tc_${Math.random().toString(36).slice(2, 8)}`,
    type: "function",
    function: { name, arguments: JSON.stringify(args) },
  };
}

beforeEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
  mkdirSync(FLOWS_DIR, { recursive: true });
  /* 准备供 open(file) 使用的临时文件 */
  Bun.write(join(TEST_DIR, "test-doc.md"), "# 测试文档\n\n这是一个测试文件。\n");
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
  eventBus.removeAllListeners("sse");
});

/* ========================================================================
 * D1: close(form_id) 后 inject 带 [close] 前缀
 * ======================================================================== */

describe("D1 — close inject 格式验证", () => {
  test("close 一个 command form 后，inject 包含 [close] 前缀", async () => {
    /* 流程: open(talk) → close(talk) → open(return) → submit(return) */
    let step = 0;
    let talkFormId = "f_unknown";

    const llm = new MockLLMClient({
      responseFn: (messages) => {
        step++;
        const userMsg = (messages as Array<{ role: string; content: string }>)
          .find((m) => m.role === "user");

        if (step === 1) {
          /* 打开 talk form */
          return {
            content: "",
            toolCalls: [toolCall("open", {
              title: "打开 talk",
              type: "command",
              command: "talk",
              description: "准备发消息",
            })],
          };
        }

        if (step === 2) {
          /* 解析 form_id，然后 close */
          const m = userMsg?.content.match(/<form id="(f_[^"]+)" command="talk"/);
          if (m?.[1]) talkFormId = m[1];
          return {
            content: "",
            toolCalls: [toolCall("close", { form_id: talkFormId })],
          };
        }

        if (step === 3) {
          /* 打开 return form */
          return {
            content: "",
            toolCalls: [toolCall("open", {
              title: "完成",
              type: "command",
              command: "return",
              description: "结束",
            })],
          };
        }

        /* step >= 4: 提交 return */
        const m = userMsg?.content.match(/<form id="(f_[^"]+)" command="return"/);
        const returnFormId = m?.[1] ?? "f_unknown";
        return {
          content: "",
          toolCalls: [toolCall("submit", {
            title: "完成",
            form_id: returnFormId,
            summary: "已关闭 talk form",
          })],
        };
      },
    });

    const config: EngineConfig = {
      rootDir: TEST_DIR,
      flowsDir: FLOWS_DIR,
      llm,
      directory: [],
      traits: [],
      stone: makeStone("tester"),
      onTalk: async () => ({ reply: null, remoteThreadId: "user" }),
      schedulerConfig: {
        maxIterationsPerThread: 20,
        maxTotalIterations: 40,
        deadlockGracePeriodMs: 0,
      },
    };

    const result = await runWithThreadTree("tester", "测试 close inject", "user", config);
    expect(result.status).toBe("done");

    /* 从磁盘读 thread.json，验证 close inject 格式 */
    const sessionDir = join(FLOWS_DIR, result.sessionId);
    const threadsJsonPath = join(sessionDir, "objects", "tester", "threads.json");
    const threadsJson = JSON.parse(await Bun.file(threadsJsonPath).text());
    const rootId = threadsJson.rootId as string;
    const threadPath = join(sessionDir, "objects", "tester", "threads", rootId, "thread.json");
    const thread = JSON.parse(await Bun.file(threadPath).text());

    const injectActions = (thread.actions as ThreadAction[]).filter((a) => a.type === "inject");

    /* 必须存在一个 inject 包含 [close] 前缀 */
    const closeInject = injectActions.find((a) => a.content.includes("[close]"));
    expect(closeInject).toBeDefined();

    /* inject 内容应包含 form_id */
    expect(closeInject!.content).toContain("已关闭");

    /* inject 内容应提到 trait 卸载状态 */
    const hasTrait = closeInject!.content.includes("本次卸载 trait") ||
      closeInject!.content.includes("无 trait 被卸载") ||
      closeInject!.content.includes("已固定 trait 保留未卸载");
    expect(hasTrait).toBe(true);
  });

  test("close 一个 _file form 后，inject 包含文件移除信息", async () => {
    /* 流程: open(file, path="README.md") → close(file_form_id) → open(return) → submit */
    let step = 0;
    let fileFormId = "f_unknown";

    const llm = new MockLLMClient({
      responseFn: (messages) => {
        step++;
        const userMsg = (messages as Array<{ role: string; content: string }>)
          .find((m) => m.role === "user");

        if (step === 1) {
          return {
            content: "",
            toolCalls: [toolCall("open", {
              title: "打开文件",
              type: "file",
              path: "test-doc.md",
            })],
          };
        }

        if (step === 2) {
          /* 解析 file form_id */
          const m = userMsg?.content.match(/<form id="(f_[^"]+)" command="_file"/);
          if (m?.[1]) fileFormId = m[1];
          return {
            content: "",
            toolCalls: [toolCall("close", { form_id: fileFormId })],
          };
        }

        if (step === 3) {
          return {
            content: "",
            toolCalls: [toolCall("open", {
              title: "完成",
              type: "command",
              command: "return",
              description: "结束",
            })],
          };
        }

        const m = userMsg?.content.match(/<form id="(f_[^"]+)" command="return"/);
        const returnFormId = m?.[1] ?? "f_unknown";
        return {
          content: "",
          toolCalls: [toolCall("submit", {
            title: "完成",
            form_id: returnFormId,
            summary: "文件关闭",
          })],
        };
      },
    });

    const config: EngineConfig = {
      rootDir: TEST_DIR,
      flowsDir: FLOWS_DIR,
      llm,
      directory: [],
      traits: [],
      stone: makeStone("tester2"),
      onTalk: async () => ({ reply: null, remoteThreadId: "user" }),
      schedulerConfig: {
        maxIterationsPerThread: 20,
        maxTotalIterations: 40,
        deadlockGracePeriodMs: 0,
      },
    };

    const result = await runWithThreadTree("tester2", "测试文件 close inject", "user", config);
    expect(result.status).toBe("done");

    const sessionDir = join(FLOWS_DIR, result.sessionId);
    const threadsJsonPath = join(sessionDir, "objects", "tester2", "threads.json");
    const threadsJson = JSON.parse(await Bun.file(threadsJsonPath).text());
    const rootId = threadsJson.rootId as string;
    const threadPath = join(sessionDir, "objects", "tester2", "threads", rootId, "thread.json");
    const thread = JSON.parse(await Bun.file(threadPath).text());

    const injectActions = (thread.actions as ThreadAction[]).filter((a) => a.type === "inject");

    /* 文件 form close 应有 [close] 前缀 */
    const closeInject = injectActions.find((a) => a.content.includes("[close]"));
    expect(closeInject).toBeDefined();

    /* 应提示文件已移除，而不是"无 trait 被卸载" */
    expect(closeInject!.content).toContain("已从上下文窗口移除");
    expect(closeInject!.content).not.toContain("无 trait 被卸载");
  });
});
