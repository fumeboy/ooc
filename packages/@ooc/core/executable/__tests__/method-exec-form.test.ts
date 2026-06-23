/**
 * method-exec-form.test —— 填表式渐进式执行（route → method_exec form lifecycle）。
 *
 * 设计权威：`.ooc-world-meta/.../children/executable/self.md`「填表式渐进式执行」。
 *
 * 验证：object method 声明 `route` 时，exec 不直执行，而是先跑 route：
 * - route 返回非 quickSubmit ⇒ 建 method_exec form 窗入 thread.contextWindows、原方法不执行、tip 作 tool 结果
 * - route 返回 quickSubmit   ⇒ 跳过 form，原方法立即执行
 * - form 上的 refine 累积参数、submit 触发原方法执行（success 移除窗 / failed 留 result 可复活）
 * - form inline 持久化随 thread context 往返
 */

import { describe, it, expect } from "bun:test";
import { THREAD_CLASS_ID } from "@ooc/core/_shared/types/constants.js";
import "@ooc/core/runtime/register-builtins.js";
import { builtinRegistry, createObjectRegistry, type ObjectRegistry } from "@ooc/core/runtime/object-registry.js";
import { handleExecTool } from "../tools/exec.js";
import type { OocObjectRef } from "@ooc/core/runtime/ooc-class.js";
import type { ThreadContext } from "@ooc/builtins/agent/thread/types.js";
import {
  materializeWindow,
  getSessionObjectTable,
} from "@ooc/core/runtime/session-object-table.js";
import { objectDataOf } from "@ooc/core/_shared/types/context-window.js";
import { serializeXml, xmlElement, type XmlNode } from "@ooc/core/_shared/types/xml.js";
import { buildInputItems } from "@ooc/builtins/agent/thread/thinkable/context/index.js";
import formReadable from "@ooc/builtins/agent/method_exec_form/readable/index.js";
import type { Data as FormData } from "@ooc/builtins/agent/method_exec_form/types.js";
import { createFlowObject } from "@ooc/core/persistable/flow-object.js";
import { loadObject, saveObject } from "@ooc/core/persistable/runtime-object-io.js";
import type { ThreadPersistenceRef } from "@ooc/core/_shared/types/thread.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeThread } from "../../__tests__/make-thread.js";
import type { SelfProxy } from "@ooc/core/_shared/types/self-proxy.js";
import { makeReadonlySelfProxy } from "@ooc/core/runtime/self-proxy.js";

/** 测试 class `test_note`：method `save` 带 route（content 空给 tip，否则 create/update 意图）。 */
function registerTestNote(reg: ObjectRegistry): { execCount: () => number } {
  let execCount = 0;
  reg.register("test_note", {
    construct: {
      description: "create test note",
      exec: () => ({ saved: [] as string[] }),
    },
    executable: {
      methods: [
        {
          name: "save",
          description: "save content",
          schema: {
            args: {
              content: { type: "string", required: true, description: "正文" },
              id: { type: "string", required: false, description: "记录 id" },
            },
          },
          route: (_ctx, _self, args: Record<string, unknown>) => {
            if (!args.content) {
              return { tip: "需要补充参数 content（留空 id=新建）", intents: [] };
            }
            if (args.quick) {
              return { intents: ["create"], quickSubmit: true };
            }
            return { intents: args.id ? ["update"] : ["create"] };
          },
          exec: (_ctx, self: SelfProxy<{ saved: string[] }>, args: Record<string, unknown>) => {
            if (!args.content) return { err: "content 为空" };
            if (args.boom) throw new Error("boom");
            execCount += 1;
            self.data.saved.push(String(args.content));
            return `saved → ${self.data.saved.length}`;
          },
        },
      ],
    },
    readable: {
      readable: () => ({ class: "test_note", content: [] }),
      window: [{ class: "test_note", object_methods: ["save"], window_methods: [] }],
    },
  });
  return { execCount: () => execCount };
}

/** 往 thread 放一个 test_note 实例窗（data 登记进 session 对象表），返回其 id。 */
function seedNote(thread: ThreadContext): string {
  const id = "note1";
  const inst: OocObjectRef = materializeWindow(thread, {
    id,
    class: "test_note",
    data: { saved: [] },
    title: "note",
    status: "open",
    createdAt: 0,
  });
  thread.contextWindows.push(inst);
  return id;
}

describe("route → method_exec form", () => {
  it("route 返回非 quickSubmit ⇒ 建 form 窗、原方法不执行、tip 作 tool 结果", async () => {
    const reg = createObjectRegistry();
    const note = registerTestNote(reg);
    const thread = makeThread();
    const noteId = seedNote(thread);

    const out = await handleExecTool(
      thread,
      { window_id: noteId, method: "save", title: "save record", args: { content: "" } },
      reg,
    );

    // 原方法未执行
    expect(note.execCount()).toBe(0);

    // form 窗出现在 context，状态 open，累积了入参
    const form = thread.contextWindows.find((w) => w.class === "method_exec");
    expect(form).toBeDefined();
    const data = objectDataOf(form!, getSessionObjectTable(thread)) as {
      accumulatedArgs: Record<string, unknown>;
      status: string;
    };
    expect(data.status).toBe("open");
    expect(data.accumulatedArgs).toEqual({ content: "" });

    // tool 结果含 route 的 tip
    expect(out).toContain("需要补充参数 content");
  });

  it("route 返回 quickSubmit ⇒ 跳过 form，原方法立即执行", async () => {
    const reg = createObjectRegistry();
    const note = registerTestNote(reg);
    const thread = makeThread();
    const noteId = seedNote(thread);

    const out = await handleExecTool(
      thread,
      { window_id: noteId, method: "save", title: "save now", args: { content: "hi", quick: true } },
      reg,
    );

    // 原方法已执行
    expect(note.execCount()).toBe(1);
    // 不建 form 窗
    expect(thread.contextWindows.find((w) => w.class === "method_exec")).toBeUndefined();
    expect(out).toContain("saved");
  });
});

/** 在 thread 上开一个 form（content 空），返回 form 窗 id。 */
async function openForm(thread: ThreadContext, reg: ObjectRegistry, noteId: string): Promise<string> {
  await handleExecTool(
    thread,
    { window_id: noteId, method: "save", title: "save record", args: { content: "" } },
    reg,
  );
  const form = thread.contextWindows.find((w) => w.class === "method_exec");
  if (!form) throw new Error("form 未创建");
  return form.id;
}

describe("form.refine", () => {
  it("refine 把新 args merge 进 accumulatedArgs，form 仍 open", async () => {
    const reg = createObjectRegistry();
    const note = registerTestNote(reg);
    const thread = makeThread();
    const noteId = seedNote(thread);
    const formId = await openForm(thread, reg, noteId);

    const out = await handleExecTool(
      thread,
      { window_id: formId, method: "refine", title: "refine", args: { content: "hello" } },
      reg,
    );

    // 原方法仍未执行（refine 只累积，不触发 exec）
    expect(note.execCount()).toBe(0);
    const form = thread.contextWindows.find((w) => w.id === formId)!;
    const data = objectDataOf(form, getSessionObjectTable(thread)) as {
      accumulatedArgs: Record<string, unknown>;
      status: string;
    };
    expect(data.accumulatedArgs.content).toBe("hello");
    expect(data.status).toBe("open");
    expect(JSON.parse(out).ok).toBe(true);
  });

  it("refine 重跑 route：补齐参数后 intentPaths 随意图刷新、tip 清除", async () => {
    const reg = createObjectRegistry();
    registerTestNote(reg);
    const thread = makeThread();
    const noteId = seedNote(thread);
    const formId = await openForm(thread, reg, noteId);

    // 开表时 content 空 → route 给 tip、intents 空
    const opened = objectDataOf(
      thread.contextWindows.find((w) => w.id === formId)!,
      getSessionObjectTable(thread),
    ) as FormData;
    expect(opened.tip).toContain("需要补充");

    await handleExecTool(
      thread,
      { window_id: formId, method: "refine", title: "refine", args: { content: "hello" } },
      reg,
    );

    // 补齐 content（无 id）→ route 重算 intents=["create"]、不再有 tip
    const refined = objectDataOf(
      thread.contextWindows.find((w) => w.id === formId)!,
      getSessionObjectTable(thread),
    ) as FormData;
    expect(refined.intentPaths).toEqual(["create"]);
    expect(refined.tip).toBeUndefined();
  });
});

describe("form.submit", () => {
  it("submit 触发目标 method 执行（用累积参数），成功后 form 从 context 移除", async () => {
    const reg = createObjectRegistry();
    const note = registerTestNote(reg);
    const thread = makeThread();
    const noteId = seedNote(thread);
    const formId = await openForm(thread, reg, noteId);
    await handleExecTool(
      thread,
      { window_id: formId, method: "refine", title: "refine", args: { content: "hello" } },
      reg,
    );

    const out = await handleExecTool(
      thread,
      { window_id: formId, method: "submit", title: "submit" },
      reg,
    );

    // 目标 method 用累积参数执行了一次
    expect(note.execCount()).toBe(1);
    // form 成功后从 context 移除
    expect(thread.contextWindows.find((w) => w.id === formId)).toBeUndefined();
    // 目标对象 data 被真正改动
    const noteWin = thread.contextWindows.find((w) => w.id === noteId)!;
    expect(
      (objectDataOf(noteWin, getSessionObjectTable(thread)) as { saved: string[] }).saved,
    ).toContain("hello");
    expect(out).toContain("saved");
  });

  it("submit 失败 ⇒ status=failed 留 result，refine 可复活回 open 后重 submit 成功", async () => {
    const reg = createObjectRegistry();
    const note = registerTestNote(reg);
    const thread = makeThread();
    const noteId = seedNote(thread);
    const formId = await openForm(thread, reg, noteId);
    await handleExecTool(
      thread,
      { window_id: formId, method: "refine", title: "refine", args: { content: "x", boom: true } },
      reg,
    );

    // 第一次 submit：目标 method throw → form failed
    const failOut = await handleExecTool(
      thread,
      { window_id: formId, method: "submit", title: "submit" },
      reg,
    );
    expect(failOut).toContain("form failed");
    const failed = thread.contextWindows.find((w) => w.id === formId)!;
    const failedData = objectDataOf(failed, getSessionObjectTable(thread)) as {
      status: string;
      result?: string;
    };
    expect(failedData.status).toBe("failed");
    expect(failedData.result).toContain("boom");
    expect(note.execCount()).toBe(0);

    // refine 去掉 boom → 复活回 open
    await handleExecTool(
      thread,
      { window_id: formId, method: "refine", title: "refine", args: { boom: false } },
      reg,
    );
    expect(
      (
        objectDataOf(
          thread.contextWindows.find((w) => w.id === formId)!,
          getSessionObjectTable(thread),
        ) as { status: string }
      ).status,
    ).toBe("open");

    // 重 submit → 成功
    await handleExecTool(thread, { window_id: formId, method: "submit", title: "submit" }, reg);
    expect(note.execCount()).toBe(1);
    expect(thread.contextWindows.find((w) => w.id === formId)).toBeUndefined();
  });
});

describe("form readable 投影", () => {
  const mkData = (over: Partial<FormData> = {}): FormData => ({
    targetObjectId: "note1",
    method: "save",
    description: "save content",
    accumulatedArgs: { content: "hello" },
    tip: "需要补充 id",
    intentPaths: ["create"],
    loadedKnowledgePaths: [],
    methodKnowledgePaths: [],
    status: "open",
    ...over,
  });

  it("window 声明把 refine / submit 暴露为方法菜单", () => {
    const decl = formReadable.window.find((w) => w.class === "method_exec")!;
    expect(decl.object_methods).toEqual(expect.arrayContaining(["refine", "submit"]));
    // registry 也确实解析得到这两条 object method
    expect(builtinRegistry.resolveObjectMethods("method_exec").map((m) => m.name)).toEqual(
      expect.arrayContaining(["refine", "submit"]),
    );
  });

  it("投影渲染 method / accumulated_args / tip", () => {
    const proj = formReadable.readable({} as never, makeReadonlySelfProxy(mkData()), {}) as {
      class: string;
      content: XmlNode[];
    };
    expect(proj.class).toBe("method_exec");
    const xml = serializeXml(xmlElement("window", { class: proj.class }, proj.content));
    expect(xml).toContain("save");
    expect(xml).toContain("hello");
    expect(xml).toContain("需要补充 id");
  });
});

describe("form 真实上屏 LLM context", () => {
  it("buildInputItems 把 form 窗本体 + refine/submit 方法菜单都渲进发给 LLM 的 input", async () => {
    const thread = makeThread();
    thread.contextWindows.push(
      materializeWindow(thread, {
        id: "f_probe",
        class: "method_exec",
        data: {
          targetObjectId: "note1",
          method: "save",
          description: "save content",
          accumulatedArgs: { content: "" },
          tip: "需要补充参数 content",
          intentPaths: ["create"],
          loadedKnowledgePaths: [],
          methodKnowledgePaths: [],
          status: "open",
        } satisfies FormData,
        title: "save record",
        status: "open",
        createdAt: 1,
      }),
    );

    const { input } = await buildInputItems(thread);
    const text = JSON.stringify(input);

    // form 窗本体上屏：id / method / tip / 累积参数
    expect(text).toContain("f_probe");
    expect(text).toContain("需要补充参数 content");
    expect(text).toContain("accumulated_args");
    // 方法菜单上屏：window_classes 里 method_exec class 暴露 refine / submit
    expect(text).toMatch(/method_exec[\s\S]*refine/);
    expect(text).toMatch(/method_exec[\s\S]*submit/);
  });
});

describe("form inline 持久化往返", () => {
  it("method_exec form 随 thread context writeThread → readThread 还原", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "_test_meform_persist-"));
    try {
      const persistence: ThreadPersistenceRef = {
        baseDir,
        sessionId: "sess_form",
        objectId: "agent_f",
        threadId: "t_form",
      };
      await createFlowObject(persistence);
      const thread = makeThread({ id: "t_form", persistence, skipCreatorWindow: true });
      thread.contextWindows = [
        materializeWindow(thread, {
          id: "f_keep",
          class: "method_exec",
          data: {
            targetObjectId: "note1",
            method: "save",
            description: "save",
            accumulatedArgs: { content: "hi" },
            intentPaths: ["create"],
            loadedKnowledgePaths: [],
            methodKnowledgePaths: [],
            status: "open",
          } satisfies FormData,
          title: "form",
          status: "open",
          createdAt: 1,
        }),
      ];
      await saveObject(thread);

      const restored = await loadObject(THREAD_CLASS_ID, 
        { baseDir, sessionId: "sess_form", objectId: "agent_f" },
        "t_form",
      );
      const form = (restored?.contextWindows ?? []).find((w) => w.id === "f_keep");
      expect(form).toBeDefined();
      // hydrate 时 thread-persist 把 data 写回 restored 的 session 对象表，经表解析。
      const data = objectDataOf(form!, getSessionObjectTable(restored!)) as FormData;
      expect(data.accumulatedArgs.content).toBe("hi");
      expect(data.status).toBe("open");
      expect(data.targetObjectId).toBe("note1");
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });
});
