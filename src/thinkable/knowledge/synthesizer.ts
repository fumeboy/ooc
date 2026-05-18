/**
 * Knowledge synthesizer — 把 thread.contextWindows 与 protocol / activator /
 * type-level basic 来源的 KnowledgeWindow 合成在一起，返回给渲染层 / 前端。
 *
 * 数据流（每轮 LLM tick 触发一次）：
 *   buildInputItems → collectExecutableKnowledgeEntries → renderContextXml
 *
 * 合成来源：
 * - protocol：全局 KNOWLEDGE 常量；root 命令清单；reflectable（sessionId="super" 门控）；
 *   每个 command_exec form 的 knowledge() 派生条目；按 type 注入的 basicKnowledge
 * - activator：stones/{id}/knowledge/*.md 经 commandPaths 命中（full / summary）
 *
 * 注意：
 * - 不 mutate 原 thread；synthetic windows 仅出现在返回的 contextWindows 副本中，
 *   不会落到 thread.json 持久化字段
 * - command_exec form 的 commandKnowledgePaths 仍会回写（保留 LLM 看到 form 时的协议提示链路）
 * - explicit knowledge_window（用户 open_knowledge）已经在 thread.contextWindows 中，原样保留；
 *   activator 命中同一 path 时跳过（避免重复）
 *
 * 历史：本模块 2026-05-18 前位于 src/executable/index.ts，作为执行子系统的内部
 * 实现。决定 LLM 看见什么知识本质上是 thinkable 概念（即便底层依赖 executable
 * 内部的 commands / windows registry），故归位到 thinkable/knowledge。
 */

import { deriveStoneFromThread, readReadme, readRelation } from "../../persistable/index.js";
import type { ThreadContext } from "../context.js";
import { BASIC_KNOWLEDGE_PATH, KNOWLEDGE } from "./basic-knowledge.js";
import { ROOT_BASIC_PATH, ROOT_COMMANDS, ROOT_KNOWLEDGE } from "../../executable/windows/root/index.js";
import { REFLECTABLE_BASIC_PATH, REFLECTABLE_KNOWLEDGE } from "../reflectable/reflectable-knowledge.js";
import { SUPER_ALIAS_TARGET, SUPER_SESSION_ID } from "../../executable/windows/super-constants.js";
import type { CommandKnowledgeEntries, CommandTableEntry } from "../../executable/windows/command-types.js";
import { getWindowTypeDefinition } from "../../executable/windows/registry.js";
import type { CommandExecWindow, ContextWindow, KnowledgeWindow, TalkWindow } from "../../executable/windows/types.js";
import { loadServerMethods } from "../../executable/server/loader.js";
import type { ServerMethod } from "../../executable/server/types.js";
import { computeActivations } from "./activator.js";
import { loadKnowledgeIndex } from "./loader.js";

const PROGRAM_FUNCTION_PATH = "internal/executable/program/function";
const KNOWLEDGE_BODY_BYTES = 8192;

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
 * form 可能挂在任意 window 类型下（root / do_window / talk_window / ...），
 * 查找 entry 需按 parentWindowId 找到父 window 的 commands map，而非只看 ROOT_COMMANDS。
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

function lookupFormEntry(
  form: CommandExecWindow,
  thread: ThreadContext,
): CommandTableEntry | undefined {
  const parentId = form.parentWindowId;
  if (!parentId || parentId === "root") {
    return ROOT_COMMANDS[form.command];
  }
  const parent = (thread.contextWindows ?? []).find((w) => w.id === parentId);
  if (!parent) return undefined;
  const def = getWindowTypeDefinition(parent.type);
  return def.commands[form.command];
}

/**
 * 把当前 form 的 commandKnowledgePaths 字段同步为最新派生 keys。
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

/** 把 thread.contextWindows 与一组合成的 KnowledgeWindow 一起返回。 */
export async function collectExecutableKnowledgeEntries(
  contextWindows: ContextWindow[] | undefined,
  thread: ThreadContext,
): Promise<{ contextWindows: ContextWindow[] | undefined; knowledgeEntries: CommandKnowledgeEntries }> {
  // 1) protocol entries —— 全局 KNOWLEDGE + root 命令清单
  const protocolEntries: CommandKnowledgeEntries = {
    [BASIC_KNOWLEDGE_PATH]: KNOWLEDGE,
    [ROOT_BASIC_PATH]: ROOT_KNOWLEDGE,
  };

  // spec 2026-05-18 super-flow-channel：sessionId="super" 是反思场景门控
  if (thread.persistence?.sessionId === SUPER_SESSION_ID) {
    protocolEntries[REFLECTABLE_BASIC_PATH] = REFLECTABLE_KNOWLEDGE;
  }

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

  // 1.5) 按 thread.contextWindows 出现的 type 注入 type-level basicKnowledge——
  //      让 LLM 在没有 open 任何 command_exec 的情况下也能知道每种 window 上有哪些 command。
  //      防止"看到 talk_window 但只会试 root 上的 talk command"的常见误用。
  const presentTypes = new Set<string>();
  for (const w of list) presentTypes.add(w.type);
  for (const t of presentTypes) {
    let def;
    try {
      def = getWindowTypeDefinition(t as ContextWindow["type"]);
    } catch {
      continue;
    }
    if (!def.basicKnowledge) continue;
    const path = `internal/windows/${t}/basic`;
    if (!(path in protocolEntries)) {
      protocolEntries[path] = def.basicKnowledge;
    }
  }

  // 2) protocol entries → KnowledgeWindow（source=protocol）
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

  // 4) relation 派生 → KnowledgeWindow（source=relation）
  //    spec: meta/object/collaborable/relation；详见 deriveRelationKnowledge JSDoc
  const relationWindows = await deriveRelationKnowledge(thread);
  for (const rw of relationWindows) synthetic.push(rw);

  // 5) 返回时把 synthetic windows 附加到 enriched 的副本上
  const finalWindows = synthetic.length > 0 ? [...enriched, ...synthetic] : enriched;

  return { contextWindows: finalWindows, knowledgeEntries: protocolEntries };
}

/**
 * 按 thread 中存在的 talk_window 派生 relation knowledge_window。
 *
 * 对每个去重 peerId（target）尝试派生最多两条:
 *   - peer readme:    stones/{peerId}/readme.md（缺失则跳过该条）
 *   - self relation:  stones/{selfId}/knowledge/relations/{peerId}.md
 *                     **缺失时合成"占位"KnowledgeWindow**:body 含可直接复制的
 *                     `write_file` 提示,驱动 LLM 主动写入(替代弱 prompt)
 *
 * 跳过规则(全部静默,不写 inject,仅 console.debug):
 * - target === SUPER_ALIAS_TARGET (super 自反)→ 完全跳过 (readme + relation)
 * - thread.persistence 缺失 → 完全跳过(测试 fixture / 异常 thread)
 * - peer stones 目录 / readme.md 不存在 → 跳过 readme(relation 仍走占位)
 * - IO 错误 → 跳过该条
 *
 * 不持久化:返回的 windows 不会进入 thread.contextWindows,每轮 render 重派生。
 * id 用稳定派生 `kn_rel_<peerId>_readme` / `kn_rel_<peerId>_self`,方便 UI 跨轮稳定。
 */
export async function deriveRelationKnowledge(
  thread: ThreadContext,
): Promise<KnowledgeWindow[]> {
  if (!thread.persistence) return [];
  const { baseDir, objectId: selfId } = thread.persistence;

  const talkWindows = (thread.contextWindows ?? []).filter(
    (w): w is TalkWindow => w.type === "talk",
  );
  const peerIds = new Set<string>();
  for (const w of talkWindows) {
    if (!w.target) continue;
    if (w.target === SUPER_ALIAS_TARGET) {
      console.debug(`[relation] skip ${w.target} reason=super_alias`);
      continue;
    }
    peerIds.add(w.target);
  }
  if (peerIds.size === 0) return [];

  const out: KnowledgeWindow[] = [];
  const selfRef = { baseDir, objectId: selfId };

  for (const peerId of peerIds) {
    const peerRef = { baseDir, objectId: peerId };

    // peer readme — full body or skip
    try {
      const readme = await readReadme(peerRef);
      if (readme !== undefined) {
        out.push(makeRelationWindow(
          `kn_rel_${peerId}_readme`,
          `stones/${peerId}/readme.md`,
          truncateKnowledgeBody(readme),
        ));
      } else {
        console.debug(`[relation] skip ${peerId} reason=readme_missing`);
      }
    } catch (err) {
      console.debug(`[relation] skip ${peerId} reason=readme_io_error msg=${(err as Error).message}`);
    }

    // self relation — full body OR 占位提示
    try {
      const relation = await readRelation(selfRef, peerId);
      const path = `stones/${selfId}/knowledge/relations/${peerId}.md`;
      if (relation !== undefined) {
        out.push(makeRelationWindow(
          `kn_rel_${peerId}_self`,
          path,
          truncateKnowledgeBody(relation),
        ));
      } else {
        console.debug(`[relation] placeholder ${peerId} reason=relation_missing`);
        out.push(makeRelationWindow(
          `kn_rel_${peerId}_self`,
          path,
          buildRelationPlaceholder(selfId, peerId),
        ));
      }
    } catch (err) {
      console.debug(`[relation] skip ${peerId} reason=relation_io_error msg=${(err as Error).message}`);
    }
  }

  return out;
}

function buildRelationPlaceholder(selfId: string, peerId: string): string {
  return `暂无对 ${peerId} 的关系记录。

可通过 \`open(command="write_file", path="stones/${selfId}/knowledge/relations/${peerId}.md", content="...")\`
写入对该 peer 的认知要点(背景、合作模式、偏好、过往关键交互)。
文件会在下一轮 render 自动作为 knowledge 出现在 context。
`;
}

function makeRelationWindow(id: string, path: string, body: string): KnowledgeWindow {
  return {
    id,
    type: "knowledge",
    parentWindowId: "root",
    title: path,
    status: "open",
    createdAt: Date.now(),
    path,
    source: "relation",
    body,
    presentation: "full",
  };
}

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
