/**
 * Root window registration — 把 root window 上注册的所有 method 集中在此处。
 */

import { builtinRegistry } from "@ooc/core/extendable/_shared/registry.js";
import type { WindowManager } from "@ooc/core/executable/windows/_shared/manager.js";
import type { ContextWindow } from "@ooc/core/executable/windows/_shared/types.js";
import { doMethod } from "./method.do.js";
import { endMethod } from "./method.end.js";
import {
  openFeishuChatMethod,
  openFeishuDocMethod,
} from "@ooc/core/extendable/lark/index.js";
import { planMethod } from "./method.plan.js";
import { talkMethod } from "./method.talk.js";
import { todoMethod } from "./method.todo.js";
import { exampleMethod } from "./method.example.js";
import type { ObjectMethod } from "@ooc/core/extendable/_shared/method-types.js";

import "@ooc/builtins/file";
import "@ooc/builtins/plan";
import "@ooc/builtins/program";
import "@ooc/builtins/knowledge";
import "@ooc/builtins/search";
import "@ooc/builtins/todo";

// agency（talk/do/plan/todo/end）—— OOC Agent **基类能力**，只注册到 `_builtin/agent`（不在 root）。
// 具体 agent（supervisor）经 ooc.class 继承 _builtin/agent，从 agent 类拿 agency；
// tool-object（filesystem/terminal，parentClass=null）拿不到 → 它们不是 Agent。
const AGENCY_METHODS: Record<string, ObjectMethod> = {
  talk: talkMethod,
  do: doMethod,
  plan: planMethod,
  todo: todoMethod,
  end: endMethod,
};

// root **类**的 method —— 仅剩边缘 misc。decomposition 后归属：
// agency(talk/do/plan/todo/end) → _builtin/agent；grep/glob/open_file/write_file → filesystem；
// program → terminal；create_object → world；open_knowledge → knowledge_base。
// 残留 example（教学样板）+ feishu（extendable 集成，grill 未列为成员/维度），暂留 root。
export const ROOT_METHODS: Record<string, ObjectMethod> = {
  example: exampleMethod,
  open_feishu_chat: openFeishuChatMethod,
  open_feishu_doc: openFeishuDocMethod,
};

// agent 经类链可达的 **root-level 方法全集**（agency + root misc）——供 exec tool enum / 测试 helper。
// 不含成员窗工具（grep/program 在 filesystem/terminal 成员窗上，window_classes 单独呈现）。
const AGENT_SURFACE_METHODS: Record<string, ObjectMethod> = { ...AGENCY_METHODS, ...ROOT_METHODS };

export function getOpenableMethods(): string[] {
  return Object.keys(AGENT_SURFACE_METHODS).sort();
}

/**
 * 测试 / 直接调用 root method 的便捷入口；不走 WindowManager。
 */
export async function execRootMethod(
  name: string,
  ctx: import("@ooc/core/extendable/_shared/method-types.js").MethodExecutionContext,
): Promise<string | undefined> {
  // root-level = agency（_builtin/agent）+ root misc——测试/直调便捷入口跨二者解析。
  const entry = AGENT_SURFACE_METHODS[name];
  if (!entry) throw new Error(`execRootMethod: unknown root-level method "${name}"`);
  const raw = await entry.exec(ctx);
  if (raw && typeof raw === "object" && "ok" in raw) {
    if (raw.ok) {
      if ("window" in raw && raw.window) {
        if (ctx.manager && ctx.thread) {
          (ctx.manager as WindowManager).insertTypedWindow(raw.window as ContextWindow, ctx.thread);
        } else if (ctx.thread) {
          ctx.thread.contextWindows = [...(ctx.thread.contextWindows ?? []), raw.window];
        }
        return `Constructed ${raw.window.class} window ${raw.window.id}`;
      }
      return (raw as { ok: true; result?: string }).result;
    }
    return (raw as { ok: false; error: string }).error;
  }
  return raw;
}

/**
 * 从 (root method) 派生静态 intents 目录（仅用于测试/文档）。
 *
 * 运行时 intents 来自 onFormChange 的返回值；此函数仅返回 entry.intents 静态目录。
 */
export function deriveRootIntentPaths(
  command: string,
  _args: Record<string, unknown>,
): string[] {
  const entry = AGENT_SURFACE_METHODS[command];
  if (!entry) return [];
  return [command, ...(entry.intents ?? [])];
}

builtinRegistry.registerExecutable("root", { methods: ROOT_METHODS });
// agency 只注册到 OOC Agent 基类（不在 root）；具体 agent 经 ooc.class 继承之。
builtinRegistry.registerExecutable("_builtin/agent", { methods: AGENCY_METHODS });
