/**
 * Root window registration — 把 root window 上注册的所有 method 集中在此处。
 */

import { builtinRegistry } from "@ooc/core/extendable/_shared/registry.js";
import type { WindowManager } from "@ooc/core/executable/windows/_shared/manager.js";
import type { ContextWindow } from "@ooc/core/executable/windows/_shared/types.js";
import { doMethod } from "./method.do.js";
import { endMethod } from "./method.end.js";
import { globMethod } from "./method.glob.js";
import { grepMethod } from "./method.grep.js";
import {
  openFeishuChatMethod,
  openFeishuDocMethod,
} from "@ooc/core/extendable/lark/index.js";
import { openFileMethod } from "./method.open-file.js";
import { openKnowledgeMethod } from "./method.open-knowledge.js";
import { planMethod } from "./method.plan.js";
import { programMethod } from "./method.program.js";
import { talkMethod } from "./method.talk.js";
import { todoMethod } from "./method.todo.js";
import { writeFileMethod } from "./method.write-file.js";
import { evolveSelfMethod } from "./method.evolve-self.js";
import { createObjectMethod } from "./method.create-object.js";
import { exampleMethod } from "./method.example.js";
import type { ObjectMethod } from "@ooc/core/extendable/_shared/method-types.js";

import "@ooc/builtins/file";
import "@ooc/builtins/plan";
import "@ooc/builtins/program";
import "@ooc/builtins/knowledge";
import "@ooc/builtins/search";
import "@ooc/builtins/todo";

export const ROOT_METHODS: Record<string, ObjectMethod> = {
  talk: talkMethod,
  do: doMethod,
  program: programMethod,
  plan: planMethod,
  todo: todoMethod,
  end: endMethod,
  open_file: openFileMethod,
  open_knowledge: openKnowledgeMethod,
  write_file: writeFileMethod,
  glob: globMethod,
  grep: grepMethod,
  evolve_self: evolveSelfMethod,
  create_object: createObjectMethod,
  example: exampleMethod,
  open_feishu_chat: openFeishuChatMethod,
  open_feishu_doc: openFeishuDocMethod,
};

export function getOpenableMethods(): string[] {
  return Object.keys(ROOT_METHODS).sort();
}

/**
 * 测试 / 直接调用 root method 的便捷入口；不走 WindowManager。
 */
export async function execRootMethod(
  name: string,
  ctx: import("@ooc/core/extendable/_shared/method-types.js").MethodExecutionContext,
): Promise<string | undefined> {
  const entry = ROOT_METHODS[name];
  if (!entry) throw new Error(`execRootMethod: unknown root method "${name}"`);
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
  const entry = ROOT_METHODS[command];
  if (!entry) return [];
  return [command, ...(entry.intents ?? [])];
}

builtinRegistry.registerExecutable("root", { methods: ROOT_METHODS });
