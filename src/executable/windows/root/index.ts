/**
 * Root window registration — 把 root window 上注册的所有 command 集中在此处。
 *
 * Step 2 重构（spec 2026-05-14）：
 * - 旧 src/executable/commands/index.ts 拆分到这里 + windows/_shared/registry.ts；
 *   commands/ 目录已迁到 windows/root/，体现 "root 是一种 window type" 的从属关系
 * - 通过 registerWindowType("root", { commands }) 注入；与其它 window type 形态一致
 * - 暴露的工具函数（getOpenableCommands / deriveRootMethodPaths）只服务于 root 上的命令
 * - 暴露 ROOT_BASIC_PATH / ROOT_KNOWLEDGE：列出 root 注册的命令清单 + 用法摘要，
 *   由 src/executable/index.ts:collectExecutableKnowledgeEntries 合成为
 *   protocol 来源的 knowledge_window，每轮注入 context（参照 plan.ts 的 KNOWLEDGE 形态）
 */

import { registerWindowType } from "../_shared/registry.js";
import { doCommand } from "./command.do.js";
import { endCommand } from "./command.end.js";
import { globCommand } from "./command.glob.js";
import { grepCommand } from "./command.grep.js";
import {
  openFeishuChatCommand,
  openFeishuDocCommand,
} from "../../../extendable/lark/index.js";
import { openFileCommand } from "./command.open-file.js";
import { openKnowledgeCommand } from "./command.open-knowledge.js";
import { planCommand } from "./command.plan.js";
import { programCommand } from "./command.program.js";
import { talkCommand } from "./command.talk.js";
import { todoCommand } from "./command.todo.js";
import { writeFileCommand } from "./command.write-file.js";
import { metaprogCommand } from "./command.metaprog.js";
import type { MethodEntry } from "../_shared/method-types.js";

/**
 * Root window 上注册的命令清单（核心数据）。
 *
 * 当前所有 command 都允许通过 `open(parent_window_id?, command="X", ...)` 打开。
 * window-level 命令（如 do_window 上的 continue）由各自 windows/X.ts 注册到对应 type 上。
 */
export const ROOT_METHODS: Record<string, MethodEntry> = {
  talk: talkCommand,
  do: doCommand,
  program: programCommand,
  plan: planCommand,
  todo: todoCommand,
  end: endCommand,
  open_file: openFileCommand,
  open_knowledge: openKnowledgeCommand,
  write_file: writeFileCommand,
  glob: globCommand,
  grep: grepCommand,
  metaprog: metaprogCommand,
  open_feishu_chat: openFeishuChatCommand,
  open_feishu_doc: openFeishuDocCommand,
};

/** Protocol knowledge path（与 plan.ts 等命令文件的 *_BASIC_PATH 形态一致）。 */
export const ROOT_BASIC_PATH = "internal/windows/root/basic";

/**
 * Root window 上可用 command 的清单 + 一行用途说明。
 *
 * 每轮自动作为 protocol knowledge_window 注入，让 LLM 在没有任何 form 时也清楚
 * "我能在 root 上 open 哪些 command、每个 command 大致是干什么的"。
 *
 * 形态对应 plan.ts 的 KNOWLEDGE：纯文本，由 collectExecutableKnowledgeEntries 包成
 * KnowledgeWindow（path=ROOT_BASIC_PATH, source=protocol）。
 */
export const ROOT_KNOWLEDGE = `
root window 是每个 thread 隐含的根窗口。在 root 上可用的 command 列表如下，
通过 open(command="<name>", title="...", args={...}) 调用（args 给齐时部分 command 会立即提交 form
而无需再额外 submit；这由各个具体 command 的实现自行控制）：

| command         | 作用                                          | 主要副作用                                 |
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
export function getOpenableCommands(): string[] {
  return Object.keys(ROOT_METHODS).sort();
}

/**
 * 测试 / 直接调用 root command 的便捷入口；不走 WindowManager。
 *
 * 仅供测试使用：单测希望验证 root command 的副作用而不必构造 form 生命周期。
 * 生产代码应通过 WindowManager.openCommandExec 触发；那条路径会注入 manager
 * 与 parentWindow 等完整 ctx，并走 outcome 识别。
 *
 * 这里保持旧的"返回 string | undefined"签名以兼容大量测试断言；遇到 outcome 时压平：
 * - { ok: true, result } → result
 * - { ok: false, error } → error（与旧 string-failure 约定一致）
 */
export async function execRootMethod(
  name: string,
  ctx: import("../_shared/method-types.js").MethodExecutionContext,
): Promise<string | undefined> {
  const entry = ROOT_METHODS[name];
  if (!entry) throw new Error(`execRootMethod: unknown root command "${name}"`);
  const raw = await entry.exec(ctx);
  if (raw && typeof raw === "object" && "ok" in raw) {
    return raw.ok ? raw.result : raw.error;
  }
  return raw;
}

/**
 * 从 (root command, args) 派生此次激活的 path 集合。
 *
 * 仅服务 root level 的命令；非 root window 上的命令请直接通过 WINDOW_REGISTRY 查 entry.match()。
 *
 * @returns 点分路径数组；command 未定义时返回 []
 */
export function deriveRootMethodPaths(
  command: string,
  args: Record<string, unknown>,
): string[] {
  const entry = ROOT_METHODS[command];
  if (!entry) return [];
  try {
    return entry.match(args);
  } catch {
    return [command];
  }
}

/**
 * root window 的 renderXml hook。
 *
 * root 通常不显式渲染（外层包装 + commands 块已经足够说明 root 上可调命令），这里
 * 只返回空 children 数组，让调度器的 commands 子节点自然承担表达。
 */
function renderRoot(): import("../../../thinkable/context/xml.js").XmlNode[] {
  return [];
}

// 向 WindowRegistry 注入 root window type 的契约。
// side-effect 注册：windows/index.ts 通过 import "./root/index.js" 触发本模块加载。
registerWindowType("root", { methods: ROOT_METHODS, renderXml: renderRoot });
