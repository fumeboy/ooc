/**
 * todo_object — 由 root.todo command 一步直建的可见待办。
 */

import { builtinRegistry } from "@ooc/core/extendable/_shared/registry.js";
import type {
  ObjectMethod,
} from "@ooc/core/extendable/_shared/method-types.js";
import {
  ROOT_WINDOW_ID,
  generateWindowId,
  type TodoWindow,
} from "@ooc/core/extendable/_shared/types.js";


const TODO_TIP = `todo 登记一条可见待办，产生 todo_window。
参数：content（必填，待办内容）、activates_on（可选，命中这些 intent 时强提醒）。`;

function deriveTodoTitle(content: string, maxLen = 60): string {
  const trimmed = content.trim();
  if (trimmed.length <= maxLen) return trimmed;
  return `${trimmed.slice(0, maxLen)}...`;
}

const todoConstructor: ObjectMethod = {
  kind: "constructor",
  description: "Create a visible todo item in context.",
  intents: ["todo.activates_on"],
  schema: {
    args: {
      content: { type: "string", required: true, description: "待办内容" },
      activates_on: { type: "array", description: "命中这些 intent 时强提醒" },
    },
  },
  onFormChange(change, { args }) {
    const hasActivates = Array.isArray(args.activates_on) && args.activates_on.length > 0;
    const intents = hasActivates ? [{ name: "todo.activates_on" }] : [{ name: "todo" }];
    const hasContent = typeof args.content === "string" && args.content.trim().length > 0;
    return {
      tip: hasContent ? "Creating todo..." : TODO_TIP,
      intents,
      quick_exec_submit: hasContent,
    };
  },
  permission: () => "allow",
  exec: async (ctx) => {
    if (!ctx.thread) return { ok: false, error: "[todo] 缺少 thread context。" };
    const content = typeof ctx.args.content === "string" ? ctx.args.content : "";
    if (!content) return { ok: false, error: "[todo] 缺少 content 参数。" };
    const activatesOn = Array.isArray(ctx.args.activates_on)
      ? (ctx.args.activates_on as unknown[]).filter((v): v is string => typeof v === "string")
      : undefined;
    const todoWindow: TodoWindow = {
      id: generateWindowId("todo"),
      type: "todo",
      parentWindowId: ROOT_WINDOW_ID,
      title: deriveTodoTitle(content),
      status: "open",
      createdAt: Date.now(),
      content,
      activatesOn,
    };
    return { ok: true, window: todoWindow };
  },
};

builtinRegistry.registerExecutable("todo", {
  methods: {
    todo: todoConstructor,
  },
  isBuiltinFeature: true,
});
