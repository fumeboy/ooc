/**
 * Protocol knowledge windows — source="protocol" 的协议知识。
 *
 * 两类：
 * - **root builtin knowledge**：`builtins/root/knowledge/*.md`（交互核心 / root method 菜单 /
 *   talk·super / do·move / form / skills / 自我演化 / super flow / end 反思）。按各篇 frontmatter
 *   的 activates_on 对当前 thread 逐篇匹配，命中才注入——Object 只在相关交互面看到对应切片。
 * - **creator-reply 协议**：动态按 creator do/talk window 的 id 生成，不属于静态 root 知识。
 */
import type { ContextWindow, KnowledgeWindow } from "../../executable/windows/_shared/types.js";
import { ROOT_WINDOW_ID } from "../../executable/windows/_shared/types.js";
import type { ObjectRegistry } from "../../executable/windows/_shared/registry.js";
import { builtinRegistry } from "../../executable/windows/index.js";
import { computeActivations, loadKnowledgeIndexFromDir } from "../knowledge/index.js";
import type { KnowledgeIndex } from "../knowledge/types.js";
import { dirname, join } from "node:path";
import type { ThreadContext } from "./index.js";

/** root builtin 包的 knowledge 目录（随框架包发布，按包名解析，与 world 无关）。 */
function resolveRootKnowledgeDir(): string | undefined {
  try {
    return join(dirname(Bun.resolveSync("@ooc/builtins/root/package.json", process.cwd())), "knowledge");
  } catch {
    return undefined;
  }
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
    parentWindowId: ROOT_WINDOW_ID,
    title: path,
    status: "open",
    createdAt: Date.now(),
    path,
    source,
    body,
  };
}

/**
 * root builtin knowledge 索引 —— 随框架包发布、进程内不可变，首次加载后 memoize。
 * 测试可经 clearRootKnowledgeCache 重置。
 */
let rootKnowledgeIndex: KnowledgeIndex | undefined;
async function loadRootKnowledgeIndex(): Promise<KnowledgeIndex> {
  if (rootKnowledgeIndex) return rootKnowledgeIndex;
  const dir = resolveRootKnowledgeDir();
  rootKnowledgeIndex = dir
    ? await loadKnowledgeIndexFromDir(dir)
    : { byPath: new Map() };
  return rootKnowledgeIndex;
}

/**
 * 按 activates_on 把 root builtin knowledge 中命中当前 thread 的篇目转成 KnowledgeWindow。
 * full → 完整 body；summary → 仅 description（body 空），与 activator 渲染对齐。
 */
async function buildRootKnowledgeWindows(thread: ThreadContext): Promise<KnowledgeWindow[]> {
  const index = await loadRootKnowledgeIndex();
  if (index.byPath.size === 0) return [];
  const out: KnowledgeWindow[] = [];
  for (const act of computeActivations(thread, index)) {
    const body = act.presentation === "full" ? act.doc.body : "";
    out.push({
      ...makeKnowledgeWindow(act.path, body, "protocol"),
      presentation: act.presentation,
      description: act.doc.frontmatter.description,
    } as KnowledgeWindow);
  }
  return out;
}

/**
 * 子→父 reply protocol knowledge builder.
 * Tells sub-thread LLM the only valid reply channel is creator_window.continue/say.
 */
function buildCreatorReplyKnowledge(window: ContextWindow): string {
  if (window.type === "do") {
    return [
      "# 子→父 reply 协议（你的 creator do_window）",
      "",
      `你当前 thread 的 creator window 是 \`${window.id}\`（type=do_window，isCreatorWindow=true，不可被 close）。`,
      "",
      "**想把结果 / 状态 / 中间进展带回父线程，唯一通道**：",
      "",
      "```",
      `exec(window_id="${window.id}", method="continue", args={ msg: "<结果或状态描述>" })`,
      "```",
      "",
      "这条消息会被自动 deliver 到父 thread 的 inbox，父 LLM 下一轮就能看到。",
      "",
      "**重要边界**：",
      "- `end` method 只用于声明本轮**自己**结束，**不是回报通道**。",
      "- 即便 end 接受 `result` 参数（便捷糖），它内部仍是模拟在 creator window 上调一次 continue；",
      "  多段对话 / 复杂状态汇报，请显式走 `creator_do_window.continue`，不要塞到 end 里。",
      "- 不要 hallucinate \"reply\" / \"report\" / \"finish_with\" 等不存在的 method；只有 continue / say / wait / close。",
    ].join("\n");
  }
  // talk creator window
  return [
    "# 子→父 reply 协议（你的 creator talk_window）",
    "",
    `你当前 thread 的 creator window 是 \`${window.id}\`（type=talk_window，isCreatorWindow=true，不可被 close）。`,
    "",
    "**想给 caller 回信，唯一通道**：",
    "",
    "```",
    `exec(window_id="${window.id}", method="say", args={ msg: "<回复内容>", wait: false|true })`,
    "```",
    "",
    "这条消息会通过 talk-delivery 派送到 caller object 的对端 thread；caller 下一轮就能看到。",
    "",
    "**重要边界**：",
    "- `end` method 只用于声明本轮**自己**结束，**不是回报通道**。",
    "- 即便 end 接受 `result` 参数（便捷糖），它内部仍是模拟在 creator window 上调一次 say；",
    "  多轮往返 / 复杂确认，请显式走 `creator_talk_window.say`，不要塞到 end 里。",
    "- 不要 open 新的 talk_window 给同一个 caller；用现有的 creator talk_window 复用。",
  ].join("\n");
}

/**
 * Produce all protocol-level knowledge windows for a thread.
 *
 * - root builtin knowledge（按 activates_on 命中当前 thread 的篇目）
 * - creator-reply 协议（动态按 creator do/talk window 生成）
 */
export async function buildProtocolKnowledgeWindows(
  thread: ThreadContext,
  _registry: ObjectRegistry = builtinRegistry,
): Promise<KnowledgeWindow[]> {
  const windows: KnowledgeWindow[] = await buildRootKnowledgeWindows(thread);

  // creator-reply 协议：每个 creator do/talk window 一条，按 window id 去重。
  const seen = new Set<string>();
  for (const w of (thread.contextWindows ?? []) as ContextWindow[]) {
    const isCreator = (w.type === "do" || w.type === "talk") && w.isCreatorWindow === true;
    if (!isCreator) continue;
    const path = `internal/windows/${w.type}/creator-reply/${w.id}`;
    if (seen.has(path)) continue;
    seen.add(path);
    windows.push(makeKnowledgeWindow(path, buildCreatorReplyKnowledge(w), "protocol"));
  }

  return windows;
}
