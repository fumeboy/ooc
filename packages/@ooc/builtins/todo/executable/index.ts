/**
 * todo_object — 由 root.todo command 一步直建的可见待办。
 *
 * 2026-05-28 ooc-6 Object Unification: 从 builtin window 迁移为 builtin object。
 * 2026-06-01 P5'.5: renderXml 抽到 readable.ts。
 * 2026-06-02 P6.§4-§5: 新增 kind="constructor" todo method，root.todo 走 lookupConstructor 委托。
 *
 * - LLM 可调用的 method：todo（constructor）、close（待办完成）
 * - onClose 无副作用，window 直接释放
 */

import { builtinRegistry } from "@ooc/core/extendable/_shared/registry.js";
import type {
  ObjectMethod,
} from "@ooc/core/extendable/_shared/method-types.js";
import {
  ROOT_WINDOW_ID,
  generateWindowId,
  type TodoWindow,
  type ContextWindow,
} from "@ooc/core/extendable/_shared/types.js";
import { readable } from "../readable.js";

import type { Intent, MethodCallSchema } from "@ooc/core/thinkable/context/intent.js";
import type { MethodExecWindow } from "@ooc/core/executable/windows/method_exec/types.js";
import { buildGuidanceWindows } from "@ooc/builtins/_shared/executable/guidance.js";


const TODO_CONSTRUCTOR_BASIC = "internal/objects/todo/constructor/basic";
const TODO_CONSTRUCTOR_INPUT = "internal/objects/todo/constructor/input";

const TODO_CONSTRUCTOR_KNOWLEDGE = `
todo 用于登记一条可见待办，直接产生一个 todo_window 挂到当前 thread。

参数：
- content: 必填，待办内容
- on_command_path: 可选，命中这些 command path 时强提醒（数组）

示例：
open(command="todo", title="补集成测试", args={ content: "补 program shell 集成测试", on_command_path: ["program.shell"] })

提示：
- args.content 给齐时 open 会立刻提交 form，不需要再 refine / submit
- 完成或撤销时 close(window_id="<todo_window_id>")
`.trim();

function deriveTodoTitle(content: string, maxLen = 60): string {
  const trimmed = content.trim();
  if (trimmed.length <= maxLen) return trimmed;
  return `${trimmed.slice(0, maxLen)}...`;
}

/**
 * P6.§4-§5 constructor —— 创建 todo_window。
 *
 * 行为:
 *  - 校验 content 非空
 *  - 解析 on_command_path（可选）
 *  - generateWindowId("todo") + build TodoWindow（status="open"）
 *  - 返回 { ok: true, object: todoWindow }
 */
const todoConstructor: ObjectMethod = {
  kind: "constructor",
  paths: ["todo", "todo.on_command_path"],
  schema: {
    args: {
      content: { type: "string", required: true, description: "待办内容" },
      on_command_path: { type: "array", description: "命中这些 command path 时强提醒" },
    },
  },
  intent: (args) => {
    if (Array.isArray(args.on_command_path) && args.on_command_path.length > 0) {
      return [{ name: "todo.on_command_path" }];
    }
    return [];
  },
  onFormChange: (change, { form }) => {
    if (change.kind === "status_changed" && change.to !== "open") return [];
    // batch C narrowing(N1): onFormChange 的 form 契约层是 base，narrow 回 MethodExecWindow 取 accumulatedArgs。
    const args = change.kind === "args_refined" ? change.args : (form as MethodExecWindow).accumulatedArgs;
    const formStatus = form.status;
    const entries: Record<string, string> = {
      [TODO_CONSTRUCTOR_BASIC]: TODO_CONSTRUCTOR_KNOWLEDGE,
    };
    if (formStatus !== "open") return buildGuidanceWindows(form, entries);
    if (typeof args.content !== "string" || args.content.trim().length === 0) {
      entries[TODO_CONSTRUCTOR_INPUT] =
        "todo 还缺以下参数: content。\n" +
        "请用 refine(form_id, args={ content: \"<待办内容>\", on_command_path?: [\"<cmd>\"] }) 补齐后 submit(form_id)。\n" +
        "不要 close 重 open——form 当前在 open 状态, refine 是正确路径。";
    }
    return buildGuidanceWindows(form, entries);
  },
  permission: () => "allow",
  exec: async (ctx) => {
    if (!ctx.thread) return { ok: false, error: "[todo] 缺少 thread context。" };
    const content = typeof ctx.args.content === "string" ? ctx.args.content : "";
    if (!content) return { ok: false, error: "[todo] 缺少 content 参数。" };
    const onCommandPath = Array.isArray(ctx.args.on_command_path)
      ? (ctx.args.on_command_path as unknown[]).filter((v): v is string => typeof v === "string")
      : undefined;
    const todoWindow: TodoWindow = {
      id: generateWindowId("todo"),
      type: "todo",
      parentWindowId: ROOT_WINDOW_ID,
      title: deriveTodoTitle(content),
      status: "open",
      createdAt: Date.now(),
      content,
      onCommandPath,
    };
    return { ok: true, object: todoWindow };
  },
};

builtinRegistry.registerObjectType("todo", {
  methods: {
    todo: todoConstructor,
  },
  readable,
  // P6.§6: todo_window 是 Object 内置特性 —— 不写独立 dir，状态 inline 进所属 thread 的 context.json。
  isBuiltinFeature: true,
});
