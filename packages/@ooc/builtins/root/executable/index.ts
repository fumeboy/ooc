/**
 * Root window registration — 把 root window 上注册的所有 method 集中在此处。
 *
 * Step 2 重构（spec 2026-05-14）：
 * - 旧 src/executable/commands/index.ts 拆分到这里 + windows/_shared/registry.ts；
 *   commands/ 目录已迁到 windows/root/，体现 "root 是一种 window type" 的从属关系
 * - 通过 registerObjectType("root", { commands }) 注入；与其它 window type 形态一致
 * - 暴露的工具函数（getOpenableMethods / deriveRootIntentPaths）只服务于 root 上的 method
 * - 暴露 ROOT_BASIC_PATH / ROOT_KNOWLEDGE：列出 root 注册的命令清单 + 用法摘要，
 *   由 src/executable/index.ts:collectExecutableKnowledgeEntries 合成为
 *   protocol 来源的 knowledge_window，每轮注入 context（参照 plan.ts 的 KNOWLEDGE 形态）
 */

import { builtinRegistry } from "@ooc/core/extendable/_shared/registry.js";
import type { WindowManager } from "@ooc/core/executable/windows/_shared/manager.js";
import type { ContextObject } from "@ooc/core/executable/windows/_shared/types.js";
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
import { metaprogMethod } from "./method.metaprog.js";
import { evolveSelfMethod } from "./method.evolve-self.js";
import type { ObjectMethod } from "@ooc/core/extendable/_shared/method-types.js";
import type { Intent } from "@ooc/core/thinkable/context/intent.js";

// 2026-06-02 P6.§4-§5: root commands 现在是 thin delegator，需要对应 builtin object module
// 通过 registerObjectType 注册 constructor。这里 side-effect import 各 builtin，确保
// `lookupConstructor("file" | "plan" | "program" | "knowledge" | "search" | "todo")` 能命中。
// （core 自带的 "talk" / "do" 仍由 windows/talk + windows/do 通过 windows/index.ts 触发注册。）
import "@ooc/builtins/file";
import "@ooc/builtins/plan";
import "@ooc/builtins/program";
import "@ooc/builtins/knowledge";
import "@ooc/builtins/search";
import "@ooc/builtins/todo";

/**
 * Root window 上注册的 method 清单（核心数据；2026-05-28 ooc-6 Object Unification 改名）。
 *
 * 当前所有 method 都允许通过 `open(parent_window_id?, method="X", ...)` 调用。
 * window-level 命令（如 do_window 上的 continue）由各自 windows/X.ts 注册到对应 type 上。
 */
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
  metaprog: metaprogMethod,
  evolve_self: evolveSelfMethod,
  open_feishu_chat: openFeishuChatMethod,
  open_feishu_doc: openFeishuDocMethod,
};

/** Protocol knowledge path（与 plan.ts 等命令文件的 *_BASIC_PATH 形态一致）。 */
export const ROOT_BASIC_PATH = "internal/windows/root/basic";

/**
 * Root window 上可用 method 的清单 + 一行用途说明。
 *
 * 每轮自动作为 protocol knowledge_window 注入，让 LLM 在没有任何 form 时也清楚
 * "我能在 root 上 exec 哪些 method、每个 method 大致是干什么的"。
 *
 * 形态对应 plan.ts 的 KNOWLEDGE：纯文本，由 collectExecutableKnowledgeEntries 包成
 * KnowledgeWindow（path=ROOT_BASIC_PATH, source=protocol）。
 */
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
| write_file      | 创建/覆盖文件内容                              | 写盘 + 自动 spawn file_window；后续可走 file_window.edit |
| glob            | 按 glob pattern 匹配文件名                     | 创建 search_window kind=glob；后续可 open_match(index) |
| grep            | 按正则在文件内容里搜索                          | 创建 search_window kind=grep（含 line+snippet）；后续可 open_match(index) |
| open_feishu_chat | 把飞书群聊 / 单聊作为 ContextWindow 引入        | 创建 feishu_chat_window；不立即拉取，建议随后 refresh |
| open_feishu_doc  | 把飞书文档作为 ContextWindow 引入              | 创建 feishu_doc_window；不立即拉取，建议随后 read |

每个 command 在进入 \`open\` 后，对应的知识会由系统自动激活；上面的清单只是入口索引。
`.trim();

/** 返回所有 root 上可 open 的命令名称列表（已排序）。 */
export function getOpenableMethods(): string[] {
  return Object.keys(ROOT_METHODS).sort();
}

/**
 * 测试 / 直接调用 root method 的便捷入口；不走 WindowManager。
 *
 * 仅供测试使用：单测希望验证 root method 的副作用而不必构造 form 生命周期。
 * 生产代码应通过 WindowManager.openCommandExec 触发；那条路径会注入 manager
 * 与 self 等完整 ctx，并走 outcome 识别。
 *
 * 这里保持旧的"返回 string | undefined"签名以兼容大量测试断言；遇到 outcome 时压平：
 * - { ok: true, result } → result
 * - { ok: true, object } → 把 object 挂到 thread.contextWindows（manager 缺省时）
 *   并返回 placeholder string（与 manager.submit 一致）
 * - { ok: false, error } → error（与旧 string-failure 约定一致）
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
      // P6 (ooc-6) constructor outcome path: 把构造出的 ContextObject 挂到 thread。
      // 优先通过 manager（保证 dual-write）；若调用方未注入 manager（测试常见），
      // 退回直接 push 到 thread.contextWindows，与历史 root.* exec 内部 fallback 一致。
      if ("object" in raw) {
        if (ctx.manager && ctx.thread) {
          // batch C narrowing(N2): ctx.manager 在契约层是 unknown，narrow 回 WindowManager
          // 取 insertTypedWindow（runtime 注入的就是 WindowManager 实例）。
          // raw.object 是 base ContextObject（MethodOutcome 契约层）；narrow 回 union 以匹配 insertTypedWindow 形参。
          (ctx.manager as WindowManager).insertTypedWindow(raw.object as ContextObject, ctx.thread);
        } else if (ctx.thread) {
          ctx.thread.contextWindows = [...(ctx.thread.contextWindows ?? []), raw.object];
        }
        return `Constructed ${raw.object.type} window ${raw.object.id}`;
      }
      return raw.result;
    }
    return raw.error;
  }
  return raw;
}

/**
 * 从 (root method, args) 派生此次激活的 path 集合。
 *
 * 仅服务 root level 的 method；非 root window 上的 method 请直接通过 object registry 查 entry.intent()。
 *
 * @returns 点分路径数组；method 未定义时返回 []
 */
export function deriveRootIntentPaths(
  command: string,
  args: Record<string, unknown>,
): string[] {
  const entry = ROOT_METHODS[command];
  if (!entry) return [];
  try {
    const subIntents = entry.intent(args);
    return [command, ...subIntents.map((i) => i.name)];
  } catch {
    return [command];
  }
}

/** root window 的 renderXml hook 已迁出到 ../readable.ts。 */
import { readable } from "../readable.js";

// 向 object registry 注入 root window type 的契约。
// side-effect 注册：windows/index.ts 通过 import "./root/index.js" 触发本模块加载。
builtinRegistry.registerObjectType("root", { methods: ROOT_METHODS, readable });
