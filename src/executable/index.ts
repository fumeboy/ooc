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
import { ROOT_BASIC_PATH, ROOT_COMMANDS, ROOT_KNOWLEDGE } from "./windows/root/index.js";
import type { CommandKnowledgeEntries } from "./windows/command-types.js";
import { getWindowTypeDefinition } from "./windows/registry.js";
import type { CommandExecWindow, ContextWindow, KnowledgeWindow } from "./windows/types.js";
import { loadServerMethods } from "./server/loader.js";
import type { ServerMethod } from "./server/types.js";
import { computeActivations, loadKnowledgeIndex } from "../thinkable/knowledge/index.js";

/** executable 子系统的全局基础知识，每轮都进入 context。 */
export const KNOWLEDGE = `
你是一个 OOC（Object-Oriented Context）系统中的 Object。下面说明你目前所在的运行环境。

## 系统机制

OOC 把 LLM 的"上下文"组织成一组 **ContextWindow**。每个 thread 持有一个 contextWindows 列表，
每个 window 是一个持续可见的实体（不是一次性消息）：

- 每个 window 都有 id / type / title / status，并按各自 type 注册一组可被你调用的 command
- LLM（你）通过 5 个原语作用在 window 上：
  - open(parent_window_id?, command, title, args?)：在某个 window 上 open 一个 command，
    创建 command_exec sub-window；当 args 已经无歧义且不引入新 knowledge 时，
    系统会立即执行该 command（C 规则），不需要再 submit
  - refine(form_id, args)：向已 open 的 command_exec form 累积参数
  - submit(form_id)：把 command_exec form 真正执行
  - close(window_id)：关闭任意 window；form 成功执行后会自动消失，无需 close
  - wait(reason)：把当前 thread 切到 waiting，等待 inbox 新消息后唤醒

## 当前 window 类型（spec 2026-05-14）

- root：每个 thread 隐含的根 window，注册了 do/talk/program/plan/end/todo/open_file/open_knowledge 等顶层 command
- command_exec：调用某个 command 时产生的临时 sub-window（即"form"）
- do：fork 子线程后产生的对话窗口；通过它的 continue/wait/close command 与子线程交互
- todo：可见待办；由 root.todo 直建
- talk：与 user 的会话窗口；通过它的 say/wait/close command 收发消息
- program：代码执行窗口（REPL 风格），exec 历史保留
- file / knowledge：把文件 / 知识文档纳入 context

## 你处在自己的"思考空间"

**重要：你接下来发出的 message 文本不会被任何对象阅读。**

整个 thread 是你自己的私有思考空间，不存在隐式的对话对象。LLM 在这个 loop 内的所有
plain text 输出、reasoning 都只是你自己的思考记录。它们不会被任何 user / 其他 Object 看见。

如果你需要让外部知道你在做什么、得到什么结论、提出什么问题：
- 与人类 user 沟通：必须 \`open(command="talk", args={ target: "user", title: "..." })\`
  创建一个 talk_window，再通过该 talk_window 的 \`say\` command 发消息——这才是 user 真正能看到的通道
- 向其它 Object 发消息：跨 Object talk 当前阶段未实现；你只能 talk to user
- 让 thread 推进/结束：用 plan / todo / end 等 command 显式表达，不要依赖 message 文本

## 工具调用规则

- 每次工具调用都附带 title，一句话说明在做什么
- 每个 window 的 title 强制必填
- 收到 inbox 消息后，下一次工具调用通过 mark 标记 msg_id

## form 生命周期

- open：刚创建，可继续 refine 或 submit
- executing：正在执行
- executed：已执行，成功则系统自动移除；失败保留 result，需要显式 close

## 一般规则

- 没有可继续动作时显式 wait(reason="...")，不要假设系统会自动暂停
- 不要只输出 plain text 等待回应——没有人在读
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

/**
 * 计算单个 command_exec form 关联的 knowledge entries。
 *
 * Step 2 重构后 form 可能挂在任意 window 类型下（root / do_window / talk_window / ...），
 * 因此查找 entry 不能只看 ROOT_COMMANDS——需要按 parentWindowId 找到父 window 的 commands map。
 */
export async function computeFormKnowledgeEntries(
  form: CommandExecWindow,
  thread: ThreadContext,
): Promise<CommandKnowledgeEntries> {
  const entry = lookupFormEntry(form, thread);
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

/** 根据 form.parentWindowId 找到父 window 的 type，再查该 type 的 commands map。 */
function lookupFormEntry(
  form: CommandExecWindow,
  thread: ThreadContext,
): import("./windows/command-types.js").CommandTableEntry | undefined {
  const parentId = form.parentWindowId;
  // root 隐含；form.parentWindowId === "root" 时落到 ROOT_COMMANDS
  if (!parentId || parentId === "root") {
    return ROOT_COMMANDS[form.command];
  }
  const parent = (thread.contextWindows ?? []).find((w) => w.id === parentId);
  if (!parent) return undefined;
  // 通过 registry 查找该 type 的 commands；动态 import 避免循环依赖
  const def = getWindowTypeDefinition(parent.type);
  return def.commands[form.command];
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
 * 把 thread.contextWindows 与一组合成的 KnowledgeWindow 一起返回。
 *
 * 合成来源（spec 2026-05-14 + 后续统一）：
 * - protocol：全局 KNOWLEDGE 常量；每个 command_exec form 的 knowledge() 派生条目
 * - activator：stones/{id}/knowledge/*.md 经 commandPaths 命中（full / summary）
 *
 * 注意：
 * - 不 mutate 原 thread；synthetic windows 仅出现在返回的 contextWindows 副本中，
 *   不会落到 thread.json 持久化字段
 * - command_exec form 的 commandKnowledgePaths 仍会回写（保留 LLM 看到 form 时的协议提示链路）
 * - explicit knowledge_window（用户 open_knowledge）已经在 thread.contextWindows 中，原样保留；
 *   activator 命中同一 path 时跳过（避免重复）
 */
export async function collectExecutableKnowledgeEntries(
  contextWindows: ContextWindow[] | undefined,
  thread: ThreadContext,
): Promise<{ contextWindows: ContextWindow[] | undefined; knowledgeEntries: CommandKnowledgeEntries }> {
  // 1) 收集 protocol 来源 entries —— 全局 KNOWLEDGE + root 命令清单 + 每个 command_exec form 的 knowledge()
  const protocolEntries: CommandKnowledgeEntries = {
    [EXECUTABLE_BASIC_PATH]: KNOWLEDGE,
    [ROOT_BASIC_PATH]: ROOT_KNOWLEDGE,
  };

  const list = contextWindows ?? [];
  const enriched: ContextWindow[] = [];
  for (const window of list) {
    if (window.type !== "command_exec") {
      enriched.push(window);
      continue;
    }
    const enrichedForm = await enrichFormCommandKnowledge(window, thread);
    enriched.push(enrichedForm);

    const entries = await computeFormKnowledgeEntries(enrichedForm, thread);
    for (const [path, content] of Object.entries(entries)) {
      if (!(path in protocolEntries)) {
        protocolEntries[path] = content;
      }
    }
  }

  // 2) 把 protocol entries 合成为 KnowledgeWindow（source=protocol）
  const synthetic: KnowledgeWindow[] = [];
  for (const [path, body] of Object.entries(protocolEntries)) {
    synthetic.push(makeKnowledgeWindow(path, body, "protocol"));
  }

  // 3) activator 命中 → KnowledgeWindow（source=activator + presentation）
  const explicitPaths = new Set(
    enriched.filter((w): w is KnowledgeWindow => w.type === "knowledge" && w.source === "explicit").map((w) => w.path),
  );
  if (thread.persistence) {
    try {
      const stoneRef = deriveStoneFromThread(thread.persistence);
      const index = await loadKnowledgeIndex(stoneRef);
      const activations = computeActivations(thread, index);
      for (const act of activations) {
        // explicit 优先；activator 重复命中同一 path 时跳过
        if (explicitPaths.has(act.path)) continue;
        const body = act.presentation === "full" ? truncateKnowledgeBody(act.doc.body) : "";
        synthetic.push({
          ...makeKnowledgeWindow(act.path, body, "activator"),
          presentation: act.presentation,
          description: act.doc.frontmatter.description,
        });
      }
    } catch {
      // 加载失败时静默：与 render 层 computeActiveKnowledgeNode 旧行为保持一致
    }
  }

  // 4) 返回时把 synthetic windows 附加到 enriched 的副本上
  const finalWindows = synthetic.length > 0 ? [...enriched, ...synthetic] : enriched;

  // 同时返回 protocolEntries 兼容 render 层 — 渲染层会逐步停用 knowledgeEntries 节点
  return { contextWindows: finalWindows, knowledgeEntries: protocolEntries };
}

const KNOWLEDGE_BODY_BYTES = 8192;

/** 与 render 层共用的 8KB 截断；本地实现避免反向 import render.ts。 */
function truncateKnowledgeBody(body: string): string {
  const bytes = new TextEncoder().encode(body);
  if (bytes.length <= KNOWLEDGE_BODY_BYTES) return body;
  const head = new TextDecoder().decode(bytes.slice(0, KNOWLEDGE_BODY_BYTES));
  return `${head}...[truncated, original ${bytes.length} bytes]`;
}

let syntheticIdCounter = 0;
function nextSyntheticId(): string {
  syntheticIdCounter += 1;
  return `kn_${Date.now().toString(36)}_${syntheticIdCounter.toString(36)}`;
}

function makeKnowledgeWindow(
  path: string,
  body: string,
  source: NonNullable<KnowledgeWindow["source"]>,
): KnowledgeWindow {
  return {
    id: nextSyntheticId(),
    type: "knowledge",
    parentWindowId: "root",
    title: path,
    status: "open",
    createdAt: Date.now(),
    path,
    source,
    body,
  };
}
