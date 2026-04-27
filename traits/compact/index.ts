/**
 * kernel:compact —— 上下文压缩 trait 的工具集实现
 *
 * 本 trait 的方法只在线程通过 `open(title="压缩上下文", command="compact", description="...")` 激活后可用。
 * 方法体通过 engine 的 program trait/method 路径触发——execCtx 会被 engine 注入
 * `__threadId`（当前线程 ID）和 `__threadsTree`（ThreadsTree 实例引用），
 * 让这些方法能够读写当前线程的 `thread.json`（actions / compactMarks / pinnedTraits）。
 *
 * 设计原则（与 G12 一致）：
 * - LLM 负责判断"什么该留什么该丢"
 * - 代码只做记账：把标记写进 `threadData.compactMarks`，submit compact 时统一消费
 * - 方法不直接改 `actions[]`——避免 LLM 单步误操作导致数据丢失，永远通过 submit 时的原子应用
 *
 * @ref docs/哲学/genes/g05-context-即世界.md — implements — 结构化遗忘兜底
 * @ref docs/哲学/genes/g12-经验沉淀.md — implements — LLM 做判断代码做记账
 * @ref docs/工程管理/迭代/all/20260422_feature_context_compact.md — references — 本迭代设计
 */

import type { TraitMethod } from "../../src/types/index";
import { toolOk, toolErr } from "../../src/types/tool-result";
import type { ToolResult } from "../../src/types/tool-result";
import type { ThreadsTree } from "../../src/thread/tree";
import type { ThreadAction, ThreadDataFile } from "../../src/thread/types";
import { estimateActionsTokens, previewCompactedTokens } from "../../src/thread/compact";

/** engine 在 buildExecContext 里注入的内部字段名 */
interface CompactCtx {
  __threadId: string;
  __threadsTree: ThreadsTree;
}

/**
 * 从 ctx 中读取 compact 必要字段（threadId + tree）
 *
 * 若缺失，说明 trait 不是通过 engine 的 program trait/method 路径激活（例如被外部复用），
 * 返回明确错误而不是 crash——方便未来扩展。
 */
function readCompactCtx(ctx: unknown): { threadId: string; tree: ThreadsTree } | string {
  const c = ctx as Partial<CompactCtx> | undefined;
  if (!c || typeof c.__threadId !== "string" || !c.__threadsTree) {
    return "compact trait 方法只能在 open(title=\"压缩上下文\", command=\"compact\", description=\"...\") 后通过 program trait/method 调用";
  }
  return { threadId: c.__threadId, tree: c.__threadsTree as ThreadsTree };
}

/**
 * 过滤"可被压缩"的 actions——compact_summary 本身和最近的 compact tool_use 不参与
 *
 * 规则：
 * - compact_summary 类型：永远跳过（已经是压缩产物）
 * - 最近一条 `open(title="压缩上下文", command="compact", description="...")` 之后（含）的 tool_use：跳过（正在进行的 compact 流程自身）
 *
 * 返回数组里的 idx 是**原始 actions 数组下标**——LLM 后续用 idx 做 truncate/drop 标记。
 */
function filterCompactableActions(actions: ThreadAction[]): Array<{ idx: number; action: ThreadAction }> {
  /* 找最近一次 open compact 的下标：从此之后（含）所有 tool_use 都跳过 */
  let lastCompactOpenIdx = -1;
  for (let i = actions.length - 1; i >= 0; i--) {
    const a = actions[i]!;
    if (a.type === "tool_use" && a.name === "open" && a.args?.command === "compact") {
      lastCompactOpenIdx = i;
      break;
    }
  }

  const result: Array<{ idx: number; action: ThreadAction }> = [];
  for (let i = 0; i < actions.length; i++) {
    const a = actions[i]!;
    if (a.type === "compact_summary") continue;
    /* 跳过 compact 流程自身的 tool_use / 相关 inject */
    if (lastCompactOpenIdx >= 0 && i >= lastCompactOpenIdx) continue;
    result.push({ idx: i, action: a });
  }
  return result;
}

/**
 * 取 action 的"一行摘要"：content 的第一行或 result 的第一行
 */
function summarizeAction(a: ThreadAction): string {
  const source = a.content || a.result || "";
  const firstLine = source.split("\n")[0] ?? "";
  return firstLine.length > 80 ? `${firstLine.slice(0, 80)}…` : firstLine;
}

/**
 * 计算 action 的总"内容行数"（content + result + args JSON）
 */
function countActionLines(a: ThreadAction): number {
  let n = 0;
  if (a.content) n += a.content.split("\n").length;
  if (a.result) n += a.result.split("\n").length;
  if (a.args) n += JSON.stringify(a.args).split("\n").length;
  return n;
}

/**
 * list_actions —— 列出所有可压缩 action 的索引 + 摘要 + 行数
 *
 * 过滤规则见 filterCompactableActions。
 * 返回 JSON 结构化文本（LLM 以 inject 形式看到）。
 */
async function listActionsImpl(ctx: unknown): Promise<ToolResult<{
  total: number; estimatedTokens: number; items: Array<{ idx: number; type: string; ts: number; summary: string; lines: number }>;
}>> {
  const ok = readCompactCtx(ctx);
  if (typeof ok === "string") return toolErr(ok);

  const td = ok.tree.readThreadData(ok.threadId);
  if (!td) return toolErr("compact.list_actions: 读取 thread.json 失败");

  const compactable = filterCompactableActions(td.actions);
  const items = compactable.map(({ idx, action }) => ({
    idx,
    type: action.type,
    ts: action.timestamp,
    summary: summarizeAction(action),
    lines: countActionLines(action),
  }));
  const estimatedTokens = estimateActionsTokens(td.actions);

  return toolOk({
    total: compactable.length,
    estimatedTokens,
    items,
  });
}

/**
 * truncate_action —— 标记某条 action 为"截断到前 N 行"
 *
 * 把标记写进 threadData.compactMarks.truncates，submit compact 时统一应用。
 * 同一 idx 多次 truncate 会覆盖（取最后一次的 maxLines）。
 */
async function truncateActionImpl(
  ctx: unknown,
  { idx, maxLines }: { idx: number; maxLines: number },
): Promise<ToolResult<{ idx: number; maxLines: number; totalMarks: number }>> {
  const ok = readCompactCtx(ctx);
  if (typeof ok === "string") return toolErr(ok);
  if (typeof idx !== "number" || !Number.isInteger(idx) || idx < 0) {
    return toolErr("truncate_action: idx 必须是非负整数");
  }
  if (typeof maxLines !== "number" || !Number.isInteger(maxLines) || maxLines <= 0) {
    return toolErr("truncate_action: maxLines 必须是正整数（建议 20~50）");
  }

  const td = ok.tree.readThreadData(ok.threadId);
  if (!td) return toolErr("truncate_action: 读取 thread.json 失败");
  if (idx >= td.actions.length) return toolErr(`truncate_action: idx=${idx} 越界（actions.length=${td.actions.length}）`);

  const nextMarks: NonNullable<ThreadDataFile["compactMarks"]> = td.compactMarks
    ? { drops: td.compactMarks.drops ? [...td.compactMarks.drops] : undefined, truncates: td.compactMarks.truncates ? [...td.compactMarks.truncates] : undefined }
    : {};
  const truncates = (nextMarks.truncates ?? []).filter(t => t.idx !== idx);
  truncates.push({ idx, maxLines });
  nextMarks.truncates = truncates;

  const nextTd: ThreadDataFile = { ...td, compactMarks: nextMarks };
  ok.tree.writeThreadData(ok.threadId, nextTd);

  return toolOk({
    idx,
    maxLines,
    totalMarks: (nextMarks.drops?.length ?? 0) + truncates.length,
  });
}

/**
 * drop_action —— 标记某条 action 整条丢弃
 *
 * reason 必须至少 20 个字符——强制 LLM 给出"为什么可以丢"的理由，
 * 防止无脑 drop 导致关键信息丢失。
 */
async function dropActionImpl(
  ctx: unknown,
  { idx, reason }: { idx: number; reason: string },
): Promise<ToolResult<{ idx: number; reason: string; totalMarks: number }>> {
  const ok = readCompactCtx(ctx);
  if (typeof ok === "string") return toolErr(ok);
  if (typeof idx !== "number" || !Number.isInteger(idx) || idx < 0) {
    return toolErr("drop_action: idx 必须是非负整数");
  }
  if (typeof reason !== "string" || reason.trim().length < 20) {
    return toolErr("drop_action: reason 必须至少 20 个字符（解释为什么这条可以丢）");
  }

  const td = ok.tree.readThreadData(ok.threadId);
  if (!td) return toolErr("drop_action: 读取 thread.json 失败");
  if (idx >= td.actions.length) return toolErr(`drop_action: idx=${idx} 越界`);
  if (td.actions[idx]!.type === "compact_summary") {
    return toolErr("drop_action: compact_summary 类型不可丢弃（它是历史背景锚点）");
  }

  const nextMarks: NonNullable<ThreadDataFile["compactMarks"]> = td.compactMarks
    ? { drops: td.compactMarks.drops ? [...td.compactMarks.drops] : undefined, truncates: td.compactMarks.truncates ? [...td.compactMarks.truncates] : undefined }
    : {};
  const drops = (nextMarks.drops ?? []).filter(d => d.idx !== idx);
  drops.push({ idx, reason: reason.trim() });
  nextMarks.drops = drops;

  const nextTd: ThreadDataFile = { ...td, compactMarks: nextMarks };
  ok.tree.writeThreadData(ok.threadId, nextTd);

  return toolOk({
    idx,
    reason: reason.trim(),
    totalMarks: drops.length + (nextMarks.truncates?.length ?? 0),
  });
}

/**
 * close_trait —— 从 pinnedTraits + activatedTraits 移除指定 trait
 *
 * 调用链：tree.deactivateTrait（deactivate 会隐含 unpin，见 tree.ts::deactivateTrait）
 */
async function closeTraitImpl(
  ctx: unknown,
  { traitId }: { traitId: string },
): Promise<ToolResult<{ traitId: string; changed: boolean }>> {
  const ok = readCompactCtx(ctx);
  if (typeof ok === "string") return toolErr(ok);
  if (typeof traitId !== "string" || traitId.trim().length === 0) {
    return toolErr("close_trait: traitId 必须是非空字符串（完整 namespace:name 格式）");
  }
  if (!traitId.includes(":")) {
    return toolErr(`close_trait: traitId 必须是完整 namespace:name 格式，如 "library:git/advanced"，收到: ${traitId}`);
  }

  const changed = await ok.tree.deactivateTrait(ok.threadId, traitId.trim());
  return toolOk({ traitId: traitId.trim(), changed });
}

/**
 * preview_compact —— 预估压缩效果
 *
 * 不执行实际压缩，只根据当前 compactMarks 计算 before/after token 数。
 */
async function previewCompactImpl(ctx: unknown): Promise<ToolResult<{
  before: number; after: number; dropCount: number; truncateCount: number; savedTokens: number;
}>> {
  const ok = readCompactCtx(ctx);
  if (typeof ok === "string") return toolErr(ok);

  const td = ok.tree.readThreadData(ok.threadId);
  if (!td) return toolErr("preview_compact: 读取 thread.json 失败");

  const before = estimateActionsTokens(td.actions);
  const after = previewCompactedTokens(td.actions, td.compactMarks ?? {});
  const dropCount = td.compactMarks?.drops?.length ?? 0;
  const truncateCount = td.compactMarks?.truncates?.length ?? 0;

  return toolOk({
    before,
    after,
    dropCount,
    truncateCount,
    savedTokens: before - after,
  });
}

/**
 * llm_methods —— compact trait 对沙箱暴露的方法集合
 *
 * 权限隔离：activates_on.show_content_when=[compact] 保证只有 open(title="压缩上下文", command="compact", description="...") 后才激活。
 */
export const llm_methods: Record<string, TraitMethod> = {
  list_actions: {
    name: "list_actions",
    description: "列出当前线程所有可压缩 action 的 {idx, type, ts, summary, lines}。compact_summary 和当前 compact 流程自身的 tool_use 会被自动过滤。",
    params: [],
    fn: listActionsImpl as TraitMethod["fn"],
  },
  truncate_action: {
    name: "truncate_action",
    description: "标记第 idx 条 action 为\"截断到前 maxLines 行\"。标记累积，submit compact 时统一应用。适合长工具返回值（只有前几行有用）。",
    params: [
      { name: "idx", type: "number", description: "action 在 actions[] 中的索引（list_actions 返回的 idx）", required: true },
      { name: "maxLines", type: "number", description: "保留的行数（建议 20~50）", required: true },
    ],
    fn: truncateActionImpl as TraitMethod["fn"],
  },
  drop_action: {
    name: "drop_action",
    description: "标记第 idx 条 action 为整条丢弃。reason 必须至少 20 字——强制说明为什么这条可以丢（故意的摩擦，防无脑丢弃）。",
    params: [
      { name: "idx", type: "number", description: "action 索引", required: true },
      { name: "reason", type: "string", description: "丢弃理由（≥20 字，如\"探索性文件读取，结论已沉淀到 memory\"）", required: true },
    ],
    fn: dropActionImpl as TraitMethod["fn"],
  },
  close_trait: {
    name: "close_trait",
    description: "从当前线程的 pinnedTraits + activatedTraits 中移除指定 trait。适合\"早期 open 的一堆工具 trait 现在不再需要\"。kernel trait 通常不该关。",
    params: [
      { name: "traitId", type: "string", description: "完整 namespace:name 格式（如 library:git/advanced）", required: true },
    ],
    fn: closeTraitImpl as TraitMethod["fn"],
  },
  preview_compact: {
    name: "preview_compact",
    description: "根据当前累积的 compactMarks 预估压缩效果，返回 {before, after, dropCount, truncateCount, savedTokens}。不执行实际压缩。",
    params: [],
    fn: previewCompactImpl as TraitMethod["fn"],
  },
};

/** 此 trait 暂不对 UI 暴露方法 */
export const ui_methods: Record<string, TraitMethod> = {};
