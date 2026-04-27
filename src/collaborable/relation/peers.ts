/**
 * Peers 扫描（Phase 5）
 *
 * 从当前线程的 actions + inbox 中提取"本线程涉及过的对象"集合（peers）。
 * Target 阶段 open-files 中枢据此决定要渲染哪些 <relations> 索引行。
 *
 * 数据源：
 * - actions[tool_use].args.target：本线程对外发起的 talk 的对方对象
 * - actions[message_out].content：历史 talk action（已记录的对外消息）
 *   注：结构化数据已在 tool_use 中体现；message_out 只是扁平化，这里不重复扫
 * - inbox[].from：收到过消息的对方
 *
 * 过滤：
 * - 自己（self）：关系归属本对象，不与自己建关系
 * - "user" / "system" / "super"：系统通道、反思分身，非对象级 peer
 * - 非字符串值：静默忽略（防御 LLM 乱填）
 *
 * 归一：
 * - 大小写不敏感做重复检测；保留首次出现的原始大小写作为输出
 *
 * @ref docs/superpowers/specs/2026-04-23-three-phase-trait-activation-design.md#第三部分-target终点
 */

import type { ThreadDataFile } from "../../thread/types.js";

/** 系统通道保留字——不参与 peer / relation 记账 */
const RESERVED_NAMES = new Set(["user", "system", "super"]);

/**
 * 扫描当前线程涉及的 peer 对象名
 *
 * @param threadData 当前线程的运行时数据
 * @param selfName   当前对象名（会被过滤）
 * @returns 按首次出现顺序排列的 peer 名字（原始大小写）
 */
export function scanPeers(
  threadData: ThreadDataFile,
  selfName: string,
): string[] {
  const selfLower = (selfName ?? "").toLowerCase();
  const seenLower = new Set<string>();
  const result: string[] = [];

  /** 尝试加入一个候选 name，已有或被过滤则跳过 */
  const tryAdd = (raw: unknown): void => {
    if (typeof raw !== "string") return;
    const trimmed = raw.trim();
    if (!trimmed) return;
    const lower = trimmed.toLowerCase();
    if (lower === selfLower) return;
    if (RESERVED_NAMES.has(lower)) return;
    if (seenLower.has(lower)) return;
    seenLower.add(lower);
    result.push(trimmed);
  };

  /* actions[tool_use].args.target */
  for (const a of threadData.actions ?? []) {
    if (a.type === "tool_use" && a.args && typeof a.args === "object") {
      const target = (a.args as Record<string, unknown>).target;
      tryAdd(target);
    }
  }

  /* inbox[].from */
  for (const m of threadData.inbox ?? []) {
    tryAdd(m.from);
  }

  return result;
}
