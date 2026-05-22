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

import { deriveStoneFromThread, readReadme, readRelation, readFlowRelation, readIssue } from "../../persistable/index.js";
import type { ThreadContext } from "../context.js";
import { BASIC_KNOWLEDGE_PATH, KNOWLEDGE } from "./basic-knowledge.js";
import { ROOT_BASIC_PATH, ROOT_COMMANDS, ROOT_KNOWLEDGE } from "../../executable/windows/root/index.js";
import {
  REFLECTABLE_BASIC_PATH,
  REFLECTABLE_KNOWLEDGE,
  REFLECTABLE_METAPROG_KNOWLEDGE,
  REFLECTABLE_METAPROG_PATH,
} from "../reflectable/reflectable-knowledge.js";
import { SUPER_ALIAS_TARGET, SUPER_SESSION_ID } from "../../executable/windows/_shared/super-constants.js";
import type { CommandKnowledgeEntries, CommandTableEntry } from "../../executable/windows/_shared/command-types.js";
import { getWindowTypeDefinition } from "../../executable/windows/_shared/registry.js";
import type { CommandExecWindow, ContextWindow, IssueWindow, KnowledgeWindow, RelationWindow, TalkWindow } from "../../executable/windows/_shared/types.js";
import { loadObjectWindow } from "../../executable/server/loader.js";
import { computeActivations } from "./activator.js";
import { loadKnowledgeIndex } from "./loader.js";

const PROGRAM_CALL_COMMAND_PATH = "internal/executable/program/callCommand";
const KNOWLEDGE_BODY_BYTES = 8192;

function samePaths(left: string[] | undefined, right: string[]): boolean {
  if (!left && right.length === 0) return true;
  if (!left || left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function defaultMethodKnowledge(_method: unknown): string {
  // 旧 ServerMethod 时代的 description/params 派生已废弃；统一在 CommandTableEntry.knowledge() 里写。
  return "";
}

async function computeProgramCallCommandKnowledge(
  form: CommandExecWindow,
  thread: ThreadContext,
): Promise<string | undefined> {
  // plan D4：program form 的 callCommand 模式 —— window_id + command 双必填
  const windowId = form.accumulatedArgs.window_id;
  const cmd = form.accumulatedArgs.command;
  if (form.command !== "program" || typeof windowId !== "string" || typeof cmd !== "string") {
    return undefined;
  }
  const targetWindow = thread.contextWindows.find((w) => w.id === windowId);
  if (!targetWindow) return undefined;

  // type=custom 时 lazy load ObjectWindowDefinition.commands[cmd].knowledge()
  if (targetWindow.type === "custom" && thread.persistence) {
    try {
      const stoneRef = deriveStoneFromThread(thread.persistence);
      const objectId = (targetWindow as { objectId?: string }).objectId;
      if (!objectId) return undefined;
      const def = await loadObjectWindow({ ...stoneRef, objectId });
      const entry = def?.commands?.[cmd];
      if (!entry) return undefined;
      const cmdArgs = (form.accumulatedArgs.args as Record<string, unknown> | undefined) ?? {};
      try {
        const ks = entry.knowledge ? entry.knowledge(cmdArgs, form.status) : {};
        const text = Object.values(ks).join("\n\n");
        return text === "" ? undefined : text;
      } catch {
        return undefined;
      }
    } catch {
      return undefined;
    }
  }
  // 内置 type 通过 registry 取
  try {
    const entry = getWindowTypeDefinition(targetWindow.type).commands[cmd];
    if (!entry?.knowledge) return undefined;
    const cmdArgs = (form.accumulatedArgs.args as Record<string, unknown> | undefined) ?? {};
    const ks = entry.knowledge(cmdArgs, form.status);
    const text = Object.values(ks).join("\n\n");
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

  const functionKnowledge = await computeProgramCallCommandKnowledge(form, thread);
  if (functionKnowledge) {
    knowledgeEntries[PROGRAM_CALL_COMMAND_PATH] = knowledgeEntries[PROGRAM_CALL_COMMAND_PATH]
      ? `${knowledgeEntries[PROGRAM_CALL_COMMAND_PATH]}\n\n${functionKnowledge}`
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
    // U7: 元编程协议指引——只在 super 注入；教 LLM 何时走 worktree 沙箱
    protocolEntries[REFLECTABLE_METAPROG_PATH] = REFLECTABLE_METAPROG_KNOWLEDGE;
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
  const synthetic: ContextWindow[] = [];
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

  // 4) relation 派生 → RelationWindow(2026-05-21 把伴随 KnowledgeWindow 内联到
  //    RelationWindow 自身的 peerReadme / selfLongTermBody / selfSessionBody;
  //    避免 UI 出现 relation_window 与 kn_rel_*_self / kn_rel_*_readme 三份重复)。
  //    spec: meta/object/collaborable/relation_window;详见 deriveRelationWindow JSDoc
  const relationWindows = await deriveRelationWindow(thread);
  for (const rw of relationWindows) synthetic.push(rw);

  // 5) issue 派生 → KnowledgeWindow（source=issue）
  //    spec: docs/plans/2026-05-19-001-feat-issue-context-window-plan.md U8;
  //    详见 deriveIssueWindowKnowledge JSDoc
  const issueWindows = await deriveIssueWindowKnowledge(thread);
  for (const iw of issueWindows) synthetic.push(iw);

  // 6) 返回时把 synthetic windows 附加到 enriched 的副本上
  const finalWindows = synthetic.length > 0 ? [...enriched, ...synthetic] : enriched;

  return { contextWindows: finalWindows, knowledgeEntries: protocolEntries };
}

/**
 * 按 thread 中存在的 talk_window 派生 RelationWindow(每个 peer 一条)。
 *
 * spec 2026-05-20 relation-window-design:relation 升级为专属 window type,
 * 自带 edit 命令面;不持久化,每轮 derive。id 稳定 `w_rel_<peerId>`。
 *
 * 2026-05-21:把原来伴随的 KnowledgeWindow(kn_rel_*_readme / kn_rel_*_self)整合到
 * RelationWindow 自身的字段(peerReadme / selfLongTermBody / selfSessionBody),让 UI
 * 不再出现"relation_window + 两条 knowledge_window"三份重复;render.ts case "relation"
 * 负责按字段渲染给 LLM。createdAt 不用 Date.now() —— polling 会让 hash 抖动 ——
 * 改用对端 talk_window 的最早 createdAt(没有就 0)。
 *
 * 跳过规则:
 * - target === SUPER_ALIAS_TARGET → 跳过(super 自反不需要 relation)
 * - thread.persistence 缺失 → 全部跳过
 *
 * IO 错误规则:全部静默(console.debug),body 字段保持 undefined,renderer 显示占位提示。
 */
export async function deriveRelationWindow(
  thread: ThreadContext,
): Promise<RelationWindow[]> {
  if (!thread.persistence) return [];
  const { baseDir, sessionId, objectId: selfId } = thread.persistence;

  const talkWindows = (thread.contextWindows ?? []).filter(
    (w): w is TalkWindow => w.type === "talk",
  );
  const peerEarliest = new Map<string, number>();
  for (const w of talkWindows) {
    if (!w.target) continue;
    if (w.target === SUPER_ALIAS_TARGET) {
      console.debug(`[relation] skip ${w.target} reason=super_alias`);
      continue;
    }
    const prev = peerEarliest.get(w.target);
    if (prev === undefined || w.createdAt < prev) peerEarliest.set(w.target, w.createdAt);
  }
  if (peerEarliest.size === 0) return [];

  const out: RelationWindow[] = [];
  const selfStoneRef = { baseDir, objectId: selfId };
  const selfFlowRef = { baseDir, sessionId, objectId: selfId };

  for (const [peerId, createdAt] of peerEarliest) {
    const peerRef = { baseDir, objectId: peerId };
    const peerReadmePath = `stones/${peerId}/readme.md`;
    const selfLongTermPath = `stones/${selfId}/knowledge/relations/${peerId}.md`;
    const selfSessionPath = `flows/${sessionId}/objects/${selfId}/knowledge/relations/${peerId}.md`;

    let peerReadme: string | undefined;
    try {
      const text = await readReadme(peerRef);
      peerReadme = text === undefined ? undefined : truncateKnowledgeBody(text);
    } catch (err) {
      console.debug(`[relation] readme io_error ${peerId} msg=${(err as Error).message}`);
    }

    let selfLongTermBody: string | undefined;
    try {
      const text = await readRelation(selfStoneRef, peerId);
      selfLongTermBody = text === undefined ? undefined : truncateKnowledgeBody(text);
    } catch (err) {
      console.debug(`[relation] long_term io_error ${peerId} msg=${(err as Error).message}`);
    }

    let selfSessionBody: string | undefined;
    try {
      const text = await readFlowRelation(selfFlowRef, peerId);
      selfSessionBody = text === undefined ? undefined : truncateKnowledgeBody(text);
    } catch (err) {
      console.debug(`[relation] session io_error ${peerId} msg=${(err as Error).message}`);
    }

    out.push({
      id: `w_rel_${peerId}`,
      type: "relation",
      parentWindowId: "root",
      title: `relation: ${peerId}`,
      status: "open",
      createdAt,
      peerId,
      peerReadmePath,
      peerReadme,
      selfLongTermPath,
      selfLongTermBody,
      selfSessionPath,
      selfSessionBody,
    });
  }
  return out;
}

/**
 * @deprecated 2026-05-21:伴随 KnowledgeWindow 已被合并进 RelationWindow 字段;
 * 本函数保留为空数组返回的 backward-compat shim,避免外部调用方一并改。
 */
export async function deriveRelationCompanionKnowledge(
  _thread: ThreadContext,
): Promise<KnowledgeWindow[]> {
  return [];
}

/** @deprecated 2026-05-21:同 deriveRelationCompanionKnowledge,旧名保留为 backward-compat。 */
export async function deriveRelationKnowledge(
  _thread: ThreadContext,
): Promise<KnowledgeWindow[]> {
  return [];
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

/** Issue 派生 body 中每条 comment 用 XML fence 包裹的截断数(只展示最近 N 条)。 */
const ISSUE_COMMENT_RECENT_N = 20;

/**
 * 按 thread 中存在的 IssueWindow 派生 issue knowledge_window。
 *
 * 对每个 IssueWindow:
 * - readIssue 读 issue-{id}.json;不存在 → 跳过 + console.debug
 * - 把 description + 最近 N=20 条 comment 渲染成 markdown body
 * - 每条 comment 用 `<comment author="X" id="N">...</comment>` XML fence 包裹
 *   (S2 防 prompt injection,LLM 把 fenced 内容当数据不当指令)
 * - 超过 N 条 → 头部加 `<omitted count="X" />` 占位
 * - 文本中的 `<` `>` `&` `"` 做 XML escape
 *
 * 不持久化:每轮 render 重派生;id 用 `kn_issue_<issueId>_body` 稳定派生方便
 * UI 跨轮稳定。
 */
export async function deriveIssueWindowKnowledge(
  thread: ThreadContext,
): Promise<KnowledgeWindow[]> {
  if (!thread.persistence) return [];
  const { baseDir, sessionId } = thread.persistence;

  const issueWindows = (thread.contextWindows ?? []).filter(
    (w): w is IssueWindow => w.type === "issue",
  );
  if (issueWindows.length === 0) return [];

  const out: KnowledgeWindow[] = [];
  // 去重:同 thread 可能多个 IssueWindow 指向同一 issueId(理论上 U5/U6 dedup
  // 已阻止,但 derive 层稳健起见再过一次)
  const seen = new Set<number>();
  for (const w of issueWindows) {
    if (seen.has(w.issueId)) continue;
    seen.add(w.issueId);

    let issue;
    try {
      issue = await readIssue(baseDir, sessionId, w.issueId);
    } catch (err) {
      console.debug(`[issue-derive] skip #${w.issueId} reason=io_error msg=${(err as Error).message}`);
      continue;
    }
    if (!issue) {
      console.debug(`[issue-derive] skip #${w.issueId} reason=issue_file_missing`);
      continue;
    }

    const body = renderIssueBody(issue.title, issue.status, issue.description, issue.comments);
    out.push({
      id: `kn_issue_${w.issueId}_body`,
      type: "knowledge",
      parentWindowId: "root",
      title: `Issue #${w.issueId}: ${issue.title}`,
      status: "open",
      createdAt: Date.now(),
      path: `flows/${sessionId}/issues/issue-${w.issueId}.json`,
      source: "issue",
      body: truncateKnowledgeBody(body),
      presentation: "full",
    });
  }

  return out;
}

/** 把 Issue 数据渲染为 markdown body;每条 comment 在 XML fence 内(S2 防注入)。 */
function renderIssueBody(
  title: string,
  status: "open" | "closed",
  description: string | undefined,
  comments: Array<{ id: number; text: string; authorObjectId: string; authorKind: "llm" | "user" }>,
): string {
  const lines: string[] = [];
  lines.push(`# ${title}`);
  lines.push("");
  lines.push(`status: ${status}`);
  lines.push("");
  if (description && description.trim()) {
    lines.push("## description");
    lines.push("");
    lines.push(description.trim());
    lines.push("");
  }
  const total = comments.length;
  const shown = comments.slice(-ISSUE_COMMENT_RECENT_N);
  const omitted = total - shown.length;
  lines.push(`## comments (showing ${shown.length} of ${total})`);
  lines.push("");
  if (omitted > 0) {
    lines.push(`<omitted count="${omitted}" />`);
    lines.push("");
  }
  for (const c of shown) {
    lines.push(
      `<comment author="${xmlEscape(c.authorObjectId)}" id="${c.id}" kind="${c.authorKind}">`,
    );
    lines.push(xmlEscape(c.text));
    lines.push(`</comment>`);
    lines.push("");
  }
  return lines.join("\n");
}

/** 最小 XML escape:防 comment 文本破坏 fence。 */
function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
