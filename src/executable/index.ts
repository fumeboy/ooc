import { deriveStoneFromThread } from "../persistable";
import type { ThreadContext } from "../thinkable/context";
import { COMMAND_TABLE } from "./commands/index.js";
import type { CommandKnowledgeEntries } from "./commands/types.js";
import type { ActiveForm } from "./forms/form";
import { loadServerMethods } from "./server/loader.js";
import type { ServerMethod } from "./server/types.js";

/** executable 子系统的全局基础知识，每轮都进入 context。 */
export const KNOWLEDGE = `
你通过 open / refine / submit / close / wait 五个执行原语行动。

- open：创建一个新的 form，声明接下来要做什么
- refine：给已有 form 逐步补充参数；只累积参数，不执行
- submit：真正执行一个 command form
- close：关闭已经消费完的 form，释放上下文占用
- wait：当需要等待外部输入、外部事件或下一轮时主动让出执行权

form 生命周期：
- open：刚创建，可继续 refine 或 submit
- executing：正在执行，不要再次 refine / submit
- executed：已有 result；阅读结果后应 close(form_id)

一般规则：
- 先 open，再按需多次 refine，参数齐全后再 submit
- form 已执行完成但结果已消费时，应及时 close，避免无效上下文积累
- 当前轮没有可继续执行的动作且需要等待时，使用 wait(reason="...")
`.trim();

const EXECUTABLE_BASIC_PATH = "internal/executable/basic";
const PROGRAM_FUNCTION_PATH = "internal/executable/program/function";

function samePaths(left: string[] | undefined, right: string[]): boolean {
  if (!left && right.length === 0) return true;
  if (!left || left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

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

async function computeProgramFunctionKnowledge(
  form: ActiveForm,
  thread: ThreadContext
): Promise<string | undefined> {
  const fn = form.accumulatedArgs.function;
  if (form.command !== "program" || typeof fn !== "string" || fn.length === 0) {
    return undefined;
  }
  if (!thread.persistence) {
    return undefined;
  }

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

export async function computeFormKnowledgeEntries(
  form: ActiveForm,
  thread: ThreadContext
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
    Object.entries(knowledgeEntries).filter(([, content]) => typeof content === "string" && content.trim() !== "")
  );
}

export async function enrichFormCommandKnowledge(
  form: ActiveForm,
  thread: ThreadContext
): Promise<ActiveForm> {
  const knowledgeEntries = await computeFormKnowledgeEntries(form, thread);
  const commandKnowledgePaths = Object.keys(knowledgeEntries);
  if (samePaths(form.commandKnowledgePaths, commandKnowledgePaths)) {
    return form;
  }
  return { ...form, commandKnowledgePaths };
}

export async function collectExecutableKnowledgeEntries(
  activeForms: ActiveForm[] | undefined,
  thread: ThreadContext
): Promise<{ activeForms: ActiveForm[] | undefined; knowledgeEntries: CommandKnowledgeEntries }> {
  const knowledgeEntries: CommandKnowledgeEntries = {
    [EXECUTABLE_BASIC_PATH]: KNOWLEDGE,
  };

  if (!activeForms || activeForms.length === 0) {
    return { activeForms, knowledgeEntries };
  }

  const enrichedForms: ActiveForm[] = [];
  for (const form of activeForms) {
    const enriched = await enrichFormCommandKnowledge(form, thread);
    enrichedForms.push(enriched);

    const entries = await computeFormKnowledgeEntries(enriched, thread);
    for (const [path, content] of Object.entries(entries)) {
      if (!(path in knowledgeEntries)) {
        knowledgeEntries[path] = content;
      }
    }
  }

  return { activeForms: enrichedForms, knowledgeEntries };
}
