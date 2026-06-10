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

export const ROOT_BASIC_PATH = "internal/windows/root/basic";

export const ROOT_KNOWLEDGE = `
root window 是每个 thread 隐含的根窗口。在 root 上可用的 method 列表如下，
exec(method="<name>", title="...", args={...}) 调用（args 给齐时部分 method 会立即提交 form
而无需再额外 submit；这由各个具体 method 的实现自行控制）：

| method          | 作用                                          | 主要副作用                                 |
|-----------------|-----------------------------------------------|--------------------------------------------|
| do              | 派生子线程                                    | 创建 child thread + do_window              |
| talk            | 与其它对象（含人类 user 与其它 flow object）持续会话；同一对象复用同一 talk_window | 创建 talk_window；发消息走 talk_window.say |
| program         | 执行代码 / 调用 server 方法                   | 创建 program_window；首次 exec 立即运行    |
| plan            | 创建/更新 root plan_window                    | 创建 plan_window（已存在则就地 update；返回 plan_window.id）|
| todo            | 登记可见待办                                  | 创建 todo_window（args 给齐时通常直接提交） |
| end             | 标记 thread 完成                              | 仅副作用                                   |
| open_file       | 把指定文件引入 context                        | 创建 file_window；后续 set_range/reload    |
| open_knowledge  | 显式打开 stone knowledge doc                  | 创建 knowledge_window（force-full 渲染）   |
| write_file      | 创建/覆盖**已存在对象**的文件内容              | 写盘 + 自动 spawn file_window；后续可走 file_window.edit |
| create_object   | 建一个**全新对象**的骨架（仅业务 session）      | 落 session worktree objects/<newId>/{package.json,self.md,readable.md[,knowledge]}；end→super flow evolve_self 合入 |
| example         | 构造 example_window（标准对象定义样板）          | 创建 example_window；后续可 bump / set_viewport / close |
| glob            | 按 glob pattern 匹配文件名                     | 创建 search_window kind=glob；后续可 open_match(index) |
| grep            | 按正则在文件内容里搜索                          | 创建 search_window kind=grep（含 line+snippet）；后续可 open_match(index) |
| open_feishu_chat | 把飞书群聊 / 单聊作为 ContextWindow 引入        | 创建 feishu_chat_window；不立即拉取，建议随后 refresh |
| open_feishu_doc  | 把飞书文档作为 ContextWindow 引入              | 创建 feishu_doc_window；不立即拉取，建议随后 read |

每个 command 在进入 exec 后，对应的知识会由系统自动激活；上面的清单只是入口索引。
`.trim();

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
        return `Constructed ${raw.window.type} window ${raw.window.id}`;
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
