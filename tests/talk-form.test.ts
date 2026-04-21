/**
 * Talk Form 迭代单元测试
 *
 * 覆盖三个关键契约：
 * 1. tool schema：submit tool 的 args 声明 optional form 字段
 * 2. engine 持久化：talk(form=...) 把 form 落盘到 message_out action
 * 3. user inbox 索引：带 form 的 talk(target="user") 经 engine 仍能正常生成
 *    messageId 并写入 user inbox；前端凭此反查正文就能拿到 form
 *
 * @ref docs/工程管理/迭代/all/20260421_feature_talk_form.md
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

import { runWithThreadTree, type EngineConfig } from "../src/thread/engine.js";
import { MockLLMClient, type ToolCall } from "../src/thinkable/client.js";
import type { StoneData } from "../src/types/index.js";
import { eventBus } from "../src/server/events.js";
import { SUBMIT_TOOL } from "../src/thread/tools.js";
import type { TalkFormPayload, ThreadAction } from "../src/thread/types.js";

const TEST_DIR = join(import.meta.dir, ".tmp_talk_form_test");
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
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
  eventBus.removeAllListeners("sse");
});

/* ========== 1. Schema 契约 ========== */

describe("tool schema — form 参数", () => {
  test("submit tool 的 args 声明 form（optional）", () => {
    const params = SUBMIT_TOOL.function.parameters as {
      properties: Record<string, { type?: string; description?: string; properties?: Record<string, unknown>; required?: string[] }>;
      required?: string[];
    };
    expect(params.properties).toHaveProperty("form");
    const form = params.properties.form;
    expect(form.type).toBe("object");
    /* form 不在 required 里——不提供时退回普通 talk */
    expect(params.required ?? []).not.toContain("form");
  });

  test("form schema 要求 type 和 options 字段", () => {
    const params = SUBMIT_TOOL.function.parameters as {
      properties: Record<string, { properties?: Record<string, { type?: string; enum?: string[] }>; required?: string[] }>;
    };
    const form = params.properties.form;
    expect(form.properties).toHaveProperty("type");
    expect(form.properties).toHaveProperty("options");
    expect(form.properties).toHaveProperty("allow_free_text");
    /* type 枚举仅 single_choice / multi_choice */
    const typeField = form.properties?.type;
    expect(typeField?.enum).toContain("single_choice");
    expect(typeField?.enum).toContain("multi_choice");
    /* form 内部 required 包含 type + options */
    expect(form.required ?? []).toContain("type");
    expect(form.required ?? []).toContain("options");
  });
});

/* ========== 2. Engine 持久化 form 到 message_out action ========== */

describe("engine — talk(form=...) 持久化", () => {
  test("带 form 的 talk → message_out action 含 form 字段 + 自动生成 formId", async () => {
    const formInput = {
      type: "single_choice",
      options: [
        { id: "A", label: "方案 A" },
        { id: "B", label: "方案 B", detail: "推荐" },
      ],
    };

    let formId = "f_unknown";
    const steps = [
      /* step 1: open talk form */
      () => ({
        content: "",
        toolCalls: [toolCall("open", {
          title: "打开 talk 表单",
          type: "command",
          command: "talk",
          description: "向 user 提问",
        })],
      }),
      /* step 2: submit talk，args 带 form */
      (messages: unknown[]) => {
        const userMsg = (messages as Array<{ role: string; content: string }>).find((m) => m.role === "user");
        const m = userMsg?.content.match(/<form id="(f_[^"]+)" command="talk"/);
        if (m?.[1]) formId = m[1];
        return {
          content: "",
          toolCalls: [toolCall("submit", {
            title: "问 user 选方案",
            form_id: formId,
            target: "user",
            message: "你选 A 还是 B？",
            form: formInput,
          })],
        };
      },
      /* step 3: open return */
      () => ({
        content: "",
        toolCalls: [toolCall("open", {
          title: "返回",
          type: "command",
          command: "return",
          description: "完成",
        })],
      }),
      /* step 4: submit return */
      (messages: unknown[]) => {
        const userMsg = (messages as Array<{ role: string; content: string }>).find((m) => m.role === "user");
        const m = userMsg?.content.match(/<form id="(f_[^"]+)" command="return"/);
        const fid = m?.[1] ?? "f_unknown";
        return {
          content: "",
          toolCalls: [toolCall("submit", {
            title: "完成",
            form_id: fid,
            summary: "已问 user",
          })],
        };
      },
    ];
    let i = 0;
    const llm = new MockLLMClient({
      responseFn: (messages) => {
        const step = steps[i++] ?? steps[steps.length - 1];
        return step(messages);
      },
    });

    const config: EngineConfig = {
      rootDir: TEST_DIR,
      flowsDir: FLOWS_DIR,
      llm,
      directory: [],
      traits: [],
      stone: makeStone("asker"),
      onTalk: async () => ({ reply: null, remoteThreadId: "user" }),
      schedulerConfig: {
        maxIterationsPerThread: 20,
        maxTotalIterations: 40,
        deadlockGracePeriodMs: 0,
      },
    };

    const result = await runWithThreadTree("asker", "你好", "user", config);
    expect(result.status).toBe("done");

    /* 落盘检查 */
    const sessionDir = join(FLOWS_DIR, result.sessionId);
    const threadsJsonPath = join(sessionDir, "objects", "asker", "threads.json");
    const threadsJson = JSON.parse(await Bun.file(threadsJsonPath).text());
    const rootId = threadsJson.rootId as string;
    const threadPath = join(sessionDir, "objects", "asker", "threads", rootId, "thread.json");
    const thread = JSON.parse(await Bun.file(threadPath).text());

    const messageOuts = (thread.actions as ThreadAction[]).filter((a) => a.type === "message_out");
    expect(messageOuts.length).toBe(1);
    const msgOut = messageOuts[0]!;
    expect(msgOut.form).toBeDefined();
    const form = msgOut.form as TalkFormPayload;
    /* formId 由 engine 生成，格式 form_xxx */
    expect(form.formId).toMatch(/^form_/);
    expect(form.type).toBe("single_choice");
    expect(form.options).toHaveLength(2);
    expect(form.options[0]?.id).toBe("A");
    expect(form.options[0]?.label).toBe("方案 A");
    expect(form.options[1]?.id).toBe("B");
    expect(form.options[1]?.detail).toBe("推荐");
    /* allow_free_text 默认 true */
    expect(form.allow_free_text).toBe(true);

    /* content 里带 [form: formId] 标记，方便 LLM 调试时也能看到 */
    expect(msgOut.content).toContain(`[form: ${form.formId}]`);
    /* message_out action 仍有 id（messageId），前端凭此反查 */
    expect(msgOut.id).toMatch(/^msg_/);
  });

  test("不带 form 的 talk → message_out action 无 form 字段（退回普通 talk）", async () => {
    const steps = [
      () => ({
        content: "",
        toolCalls: [toolCall("open", {
          title: "普通 talk",
          type: "command",
          command: "talk",
          description: "问候",
        })],
      }),
      (messages: unknown[]) => {
        const userMsg = (messages as Array<{ role: string; content: string }>).find((m) => m.role === "user");
        const m = userMsg?.content.match(/<form id="(f_[^"]+)" command="talk"/);
        const fid = m?.[1] ?? "f_unknown";
        return {
          content: "",
          toolCalls: [toolCall("submit", {
            title: "发消息",
            form_id: fid,
            target: "user",
            message: "你好",
            /* 无 form */
          })],
        };
      },
      () => ({
        content: "",
        toolCalls: [toolCall("open", {
          title: "返回",
          type: "command",
          command: "return",
          description: "done",
        })],
      }),
      (messages: unknown[]) => {
        const userMsg = (messages as Array<{ role: string; content: string }>).find((m) => m.role === "user");
        const m = userMsg?.content.match(/<form id="(f_[^"]+)" command="return"/);
        const fid = m?.[1] ?? "f_unknown";
        return {
          content: "",
          toolCalls: [toolCall("submit", {
            title: "完成",
            form_id: fid,
            summary: "ok",
          })],
        };
      },
    ];
    let i = 0;
    const llm = new MockLLMClient({
      responseFn: (messages) => {
        const step = steps[i++] ?? steps[steps.length - 1];
        return step(messages);
      },
    });

    const config: EngineConfig = {
      rootDir: TEST_DIR,
      flowsDir: FLOWS_DIR,
      llm,
      directory: [],
      traits: [],
      stone: makeStone("asker"),
      onTalk: async () => ({ reply: null, remoteThreadId: "user" }),
      schedulerConfig: {
        maxIterationsPerThread: 20,
        maxTotalIterations: 40,
        deadlockGracePeriodMs: 0,
      },
    };

    const result = await runWithThreadTree("asker", "嗨", "user", config);
    expect(result.status).toBe("done");

    const sessionDir = join(FLOWS_DIR, result.sessionId);
    const rootId = JSON.parse(await Bun.file(join(sessionDir, "objects", "asker", "threads.json")).text()).rootId as string;
    const thread = JSON.parse(await Bun.file(join(sessionDir, "objects", "asker", "threads", rootId, "thread.json")).text());
    const messageOuts = (thread.actions as ThreadAction[]).filter((a) => a.type === "message_out");
    expect(messageOuts.length).toBe(1);
    /* 无 form 字段：undefined（JSON.stringify 后直接不落盘此 key） */
    expect(messageOuts[0]?.form).toBeUndefined();
    expect(messageOuts[0]?.content).not.toContain("[form:");
  });

  test("form options 为空数组时 → 视为无效 form，退回普通 talk（不落盘 form 字段）", async () => {
    const steps = [
      () => ({
        content: "",
        toolCalls: [toolCall("open", {
          title: "空 options",
          type: "command",
          command: "talk",
          description: "test",
        })],
      }),
      (messages: unknown[]) => {
        const userMsg = (messages as Array<{ role: string; content: string }>).find((m) => m.role === "user");
        const m = userMsg?.content.match(/<form id="(f_[^"]+)" command="talk"/);
        const fid = m?.[1] ?? "f_unknown";
        return {
          content: "",
          toolCalls: [toolCall("submit", {
            title: "发",
            form_id: fid,
            target: "user",
            message: "test",
            form: { type: "single_choice", options: [] },
          })],
        };
      },
      () => ({
        content: "",
        toolCalls: [toolCall("open", {
          title: "done",
          type: "command",
          command: "return",
          description: "x",
        })],
      }),
      (messages: unknown[]) => {
        const userMsg = (messages as Array<{ role: string; content: string }>).find((m) => m.role === "user");
        const m = userMsg?.content.match(/<form id="(f_[^"]+)" command="return"/);
        const fid = m?.[1] ?? "f_unknown";
        return {
          content: "",
          toolCalls: [toolCall("submit", { title: "ok", form_id: fid, summary: "ok" })],
        };
      },
    ];
    let i = 0;
    const llm = new MockLLMClient({
      responseFn: (messages) => {
        const step = steps[i++] ?? steps[steps.length - 1];
        return step(messages);
      },
    });
    const config: EngineConfig = {
      rootDir: TEST_DIR,
      flowsDir: FLOWS_DIR,
      llm,
      directory: [],
      traits: [],
      stone: makeStone("asker"),
      onTalk: async () => ({ reply: null, remoteThreadId: "user" }),
      schedulerConfig: { maxIterationsPerThread: 20, maxTotalIterations: 40, deadlockGracePeriodMs: 0 },
    };
    const result = await runWithThreadTree("asker", "test", "user", config);
    expect(result.status).toBe("done");

    const sessionDir = join(FLOWS_DIR, result.sessionId);
    const rootId = JSON.parse(await Bun.file(join(sessionDir, "objects", "asker", "threads.json")).text()).rootId as string;
    const thread = JSON.parse(await Bun.file(join(sessionDir, "objects", "asker", "threads", rootId, "thread.json")).text());
    const messageOuts = (thread.actions as ThreadAction[]).filter((a) => a.type === "message_out");
    expect(messageOuts[0]?.form).toBeUndefined();
  });

  test("multi_choice 多选 form 也能正确落盘", async () => {
    const formInput = {
      type: "multi_choice",
      options: [
        { id: "A", label: "选项 A" },
        { id: "B", label: "选项 B" },
        { id: "C", label: "选项 C" },
      ],
      allow_free_text: true,
    };
    const steps = [
      () => ({ content: "", toolCalls: [toolCall("open", { title: "多选", type: "command", command: "talk", description: "m" })] }),
      (messages: unknown[]) => {
        const userMsg = (messages as Array<{ role: string; content: string }>).find((m) => m.role === "user");
        const m = userMsg?.content.match(/<form id="(f_[^"]+)" command="talk"/);
        const fid = m?.[1] ?? "f_unknown";
        return {
          content: "",
          toolCalls: [toolCall("submit", {
            title: "多选询问",
            form_id: fid,
            target: "user",
            message: "选哪几个？",
            form: formInput,
          })],
        };
      },
      () => ({ content: "", toolCalls: [toolCall("open", { title: "r", type: "command", command: "return", description: "r" })] }),
      (messages: unknown[]) => {
        const userMsg = (messages as Array<{ role: string; content: string }>).find((m) => m.role === "user");
        const m = userMsg?.content.match(/<form id="(f_[^"]+)" command="return"/);
        const fid = m?.[1] ?? "f_unknown";
        return { content: "", toolCalls: [toolCall("submit", { title: "ok", form_id: fid, summary: "ok" })] };
      },
    ];
    let i = 0;
    const llm = new MockLLMClient({
      responseFn: (messages) => {
        const step = steps[i++] ?? steps[steps.length - 1];
        return step(messages);
      },
    });
    const config: EngineConfig = {
      rootDir: TEST_DIR,
      flowsDir: FLOWS_DIR,
      llm,
      directory: [],
      traits: [],
      stone: makeStone("asker"),
      onTalk: async () => ({ reply: null, remoteThreadId: "user" }),
      schedulerConfig: { maxIterationsPerThread: 20, maxTotalIterations: 40, deadlockGracePeriodMs: 0 },
    };
    const result = await runWithThreadTree("asker", "test", "user", config);
    expect(result.status).toBe("done");

    const sessionDir = join(FLOWS_DIR, result.sessionId);
    const rootId = JSON.parse(await Bun.file(join(sessionDir, "objects", "asker", "threads.json")).text()).rootId as string;
    const thread = JSON.parse(await Bun.file(join(sessionDir, "objects", "asker", "threads", rootId, "thread.json")).text());
    const messageOuts = (thread.actions as ThreadAction[]).filter((a) => a.type === "message_out");
    const form = messageOuts[0]?.form as TalkFormPayload;
    expect(form).toBeDefined();
    expect(form.type).toBe("multi_choice");
    expect(form.options).toHaveLength(3);
    expect(form.allow_free_text).toBe(true);
  });
});
