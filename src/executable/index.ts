/**
 * executable 子系统 — 全局基础知识 + form-command knowledge 派生。
 *
 * Step 1 重构（spec 2026-05-14）：
 * - 旧 ActiveForm 类型已废弃，统一改用 CommandExecWindow（一种 ContextWindow）
 * - collectExecutableKnowledgeEntries 现在按 thread.contextWindows 中的 command_exec 子集派生
 * - 渲染层与 enrich 入口都迁移到新签名
 */

import { deriveStoneFromThread } from "../persistable";
import type { ThreadContext } from "../thinkable/context";
import { COMMAND_TABLE } from "./commands/index.js";
import type { CommandKnowledgeEntries } from "./commands/types.js";
import type { CommandExecWindow, ContextWindow } from "./windows/types.js";
import { loadServerMethods } from "./server/loader.js";
import type { ServerMethod } from "./server/types.js";

/** executable 子系统的全局基础知识，每轮都进入 context。 */
export const KNOWLEDGE = `
你通过 open / refine / submit / close / wait 五个执行原语行动，作用对象是 ContextWindow。

- open(parent_window_id?, command, title, args?)：在某个 window 上 open 一个 command，
  创建一个 command_exec sub-window；当 args 已经无歧义且不引入新 knowledge 时，
  系统会立即执行该 command（C 规则），不需要再 submit
- refine(form_id, args)：向已 open 的 command_exec form 累积参数
- submit(form_id)：把 command_exec form 真正执行
- close(window_id)：关闭任意 window；form 成功执行后会自动消失，无需 close
- wait(reason)：把当前 thread 切到 waiting，等待 inbox 新消息后唤醒

window 类型：
- root：每个 thread 隐含的根 window，注册了 do/talk/program/plan/end/todo 等顶层 command
- command_exec：调用某个 command 时产生的临时 sub-window（旧 form 概念的新身份）
- do：fork 子线程后产生的对话窗口；通过它的 continue/wait/close command 与子线程交互
- todo：由 root.todo command 直建的可见待办

工具调用规则：
- 每次工具调用都附带 title，一句话说明在做什么
- 每个 window 的 title 强制必填
- 收到 inbox 消息后，下一次工具调用通过 mark 标记 msg_id

form 生命周期：
- open：刚创建，可继续 refine 或 submit
- executing：正在执行
- executed：已执行，成功则系统自动移除；失败保留 result，需要显式 close

一般规则：
- 没有可继续动作时显式 wait(reason="...")
- 不要假设系统会自动暂停
- 只使用当前 contextWindows / inbox / knowledge 中实际存在的对象
`.trim();

const EXECUTABLE_BASIC_PATH = "internal/executable/basic";
const PROGRAM_FUNCTION_PATH = "internal/executable/program/function";

/** 比较两个 string[] 是否完全相同（顺序敏感）。 */
function samePaths(left: string[] | undefined, right: string[]): boolean {
  if (!left && right.length === 0) return true;
  if (!left || left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

/** 把一个 ServerMethod 渲染成默认的 knowledge 文本（缺省时使用，避免空白）。 */
function defaultMethodKnowledge(method: ServerMethod): string {
  const lines: string[] = [];
  if (method.description) {
    lines.push(method.description);
  }
  if (method.params && method.params.length > 0) {
    lines.push("参数：");
    for (const p of method.params) {
      const required = p.required ? "（必填）" : "（可选）";
      const type = p.type ? ` [${p.type}]` : "";
      const desc = p.description ? `：${p.description}` : "";
      lines.push(`- ${p.name}${type}${required}${desc}`);
    }
  }
  return lines.join("\n");
}

/**
 * 仅 program command + function 模式时附带的 method 签名 knowledge。
 *
 * 同旧实现，但输入参数从 ActiveForm 切到 CommandExecWindow。
 */
async function computeProgramFunctionKnowledge(
  form: CommandExecWindow,
  thread: ThreadContext,
): Promise<string | undefined> {
  const fn = form.accumulatedArgs.function;
  if (form.command !== "program" || typeof fn !== "string" || fn.length === 0) {
    return undefined;
  }
  if (!thread.persistence) return undefined;

  try {
    const stoneRef = deriveStoneFromThread(thread.persistence);
    const methods = await loadServerMethods(stoneRef);
    const method = methods[fn];
    if (!method) return undefined;
    const methodArgs = (form.accumulatedArgs.args as Record<string, unknown> | undefined) ?? {};
    let text: string;
    try {
      text = method.knowledge ? method.knowledge(methodArgs) : defaultMethodKnowledge(method);
    } catch {
      text = defaultMethodKnowledge(method);
    }
    return text === "" ? undefined : text;
  } catch {
    return undefined;
  }
}

/** 计算单个 command_exec form 关联的 knowledge entries。 */
export async function computeFormKnowledgeEntries(
  form: CommandExecWindow,
  thread: ThreadContext,
): Promise<CommandKnowledgeEntries> {
  const entry = COMMAND_TABLE[form.command];
  const knowledgeEntries = entry?.knowledge
    ? { ...entry.knowledge(form.accumulatedArgs, form.status) }
    : {};

  const functionKnowledge = await computeProgramFunctionKnowledge(form, thread);
  if (functionKnowledge) {
    knowledgeEntries[PROGRAM_FUNCTION_PATH] = knowledgeEntries[PROGRAM_FUNCTION_PATH]
      ? `${knowledgeEntries[PROGRAM_FUNCTION_PATH]}\n\n${functionKnowledge}`
      : functionKnowledge;
  }

  return Object.fromEntries(
    Object.entries(knowledgeEntries).filter(([, content]) => typeof content === "string" && content.trim() !== ""),
  );
}

/**
 * 把当前 form 的 commandKnowledgePaths 字段同步为最新派生 keys。
 *
 * 返回新对象；keys 没变时返回原对象（避免无效 mutation）。
 */
export async function enrichFormCommandKnowledge(
  form: CommandExecWindow,
  thread: ThreadContext,
): Promise<CommandExecWindow> {
  const knowledgeEntries = await computeFormKnowledgeEntries(form, thread);
  const commandKnowledgePaths = Object.keys(knowledgeEntries);
  if (samePaths(form.commandKnowledgePaths, commandKnowledgePaths)) {
    return form;
  }
  return { ...form, commandKnowledgePaths };
}

/**
 * 从 contextWindows 中筛出 command_exec 子集，逐个派生 knowledge 条目并合并。
 *
 * 返回：
 * - contextWindows：可能被 enrich 过的 windows 列表（命令 form 的 commandKnowledgePaths 会被刷新）
 * - knowledgeEntries：本轮要进 system context 的全部 knowledge 条目（含全局基础知识）
 */
export async function collectExecutableKnowledgeEntries(
  contextWindows: ContextWindow[] | undefined,
  thread: ThreadContext,
): Promise<{ contextWindows: ContextWindow[] | undefined; knowledgeEntries: CommandKnowledgeEntries }> {
  const knowledgeEntries: CommandKnowledgeEntries = {
    [EXECUTABLE_BASIC_PATH]: KNOWLEDGE,
  };

  if (!contextWindows || contextWindows.length === 0) {
    return { contextWindows, knowledgeEntries };
  }

  const enriched: ContextWindow[] = [];
  for (const window of contextWindows) {
    if (window.type !== "command_exec") {
      enriched.push(window);
      continue;
    }
    const enrichedForm = await enrichFormCommandKnowledge(window, thread);
    enriched.push(enrichedForm);

    const entries = await computeFormKnowledgeEntries(enrichedForm, thread);
    for (const [path, content] of Object.entries(entries)) {
      if (!(path in knowledgeEntries)) {
        knowledgeEntries[path] = content;
      }
    }
  }

  return { contextWindows: enriched, knowledgeEntries };
}
