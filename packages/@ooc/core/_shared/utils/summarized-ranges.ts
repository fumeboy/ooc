/**
 * events compress —— transcript 视角内折叠的纯类型 + 纯函数（canonical 源）。
 *
 * 折叠态 = 一组 `SummarizedRange`（`{fromIdx,toIdx,summary}`），落 `win.summarizedRanges`
 * （与 `compressLevel` 同属投影态、视角独立、可持久化）。索引坐标相对**该窗渲染的 transcript**：
 * - self 视角：索引 `thread.events`（顶层事件流，append-only，已发生 event 的 index 稳定）。
 * - peer/talk 视角：索引该会话窗的 messages transcript（filterTalkMessages 输出）。
 *
 * 一个存储形态 + 一个通用投影 helper（{@link projectSummarizedRanges}）服务两视角——
 * 各调用点传入自己的 item 列表与渲染函数，落在某 range 内的连续 items 折成一条 summary 占位。
 *
 * 段由谁写：self 视角 thread 窗的段由 `harvestSummarizerForks` 写入（compress 无参意图 → 框架 fork
 * summarizer 摘要早期历史 → harvest 折段）。投影态视角独立、不碰 object data（`thread.events` 一字不改）
 * ——thread.events 全量历史始终保留（折叠只改本窗读出投影，不删原始事件）。
 */

/** 被折叠区段：`thread.events` / messages 的数组 index 区间（含两端）+ agent 提供的摘要。 */
export interface SummarizedRange {
  /** 区段起点 index（含）。 */
  fromIdx: number;
  /** 区段终点 index（含）。 */
  toIdx: number;
  /** 该区段的摘要文本（由 summarizer fork 生成、harvest 写入）。 */
  summary: string;
}

/** 持 summarizedRanges 投影态的最小 win 形态（self 窗 / 会话窗的 win 都满足）。 */
export interface WinWithSummarizedRanges {
  summarizedRanges?: SummarizedRange[];
}

/**
 * 规整折叠区段：丢非法（非整数 / fromIdx>toIdx）、按 fromIdx 升序、合并重叠/相邻。
 *
 * `total` 可选——给定（读出侧，按真实 transcript 长度）则夹到 `[0, total-1]` 并丢空段；
 * 不给（写入侧，append 时 transcript 长度未必可知）则只规整不夹边，clamp 留给读出侧
 * （projectSummarizedRanges 用真实 items.length）。
 *
 * 输入来自 LLM args，必须 fail-soft 规整（非法段静默丢弃，不崩渲染）。合并重叠时拼接 summary，
 * 避免同一批 item 既被这段又被那段折叠导致索引跳变歧义。
 */
export function normalizeSummarizedRanges(
  ranges: readonly SummarizedRange[] | undefined,
  total?: number,
): SummarizedRange[] {
  if (!ranges || ranges.length === 0) return [];
  if (total !== undefined && total <= 0) return [];
  const valid: SummarizedRange[] = [];
  for (const r of ranges) {
    if (!r) continue;
    if (!Number.isInteger(r.fromIdx) || !Number.isInteger(r.toIdx)) continue;
    const from = Math.max(0, r.fromIdx);
    const to = total !== undefined ? Math.min(total - 1, r.toIdx) : r.toIdx;
    if (from > to) continue;
    valid.push({ fromIdx: from, toIdx: to, summary: r.summary ?? "" });
  }
  if (valid.length === 0) return [];
  valid.sort((a, b) => a.fromIdx - b.fromIdx || a.toIdx - b.toIdx);
  const merged: SummarizedRange[] = [valid[0]!];
  for (let i = 1; i < valid.length; i++) {
    const cur = valid[i]!;
    const last = merged[merged.length - 1]!;
    // 相邻（toIdx+1 === fromIdx）或重叠 → 并段，summary 拼接。
    if (cur.fromIdx <= last.toIdx + 1) {
      merged[merged.length - 1] = {
        fromIdx: last.fromIdx,
        toIdx: Math.max(last.toIdx, cur.toIdx),
        summary:
          last.summary && cur.summary && last.summary !== cur.summary
            ? `${last.summary}\n${cur.summary}`
            : last.summary || cur.summary,
      };
    } else {
      merged.push(cur);
    }
  }
  return merged;
}

/**
 * 往折叠态追加一段（纯函数，返回新数组）。写入侧**不夹边**（transcript 长度交读出侧）：
 * 仅追加 + 规整去重（排序、合并重叠/相邻），非法段（fromIdx>toIdx）静默丢。
 */
export function addSummarizedRange(
  ranges: readonly SummarizedRange[] | undefined,
  range: SummarizedRange,
): SummarizedRange[] {
  return normalizeSummarizedRanges([...(ranges ?? []), range]);
}

/**
 * 移除折叠态（纯函数，返回新数组）：
 * - 给 `at`（某 index）→ 移除覆盖该 index 的那一段（精准展开一段）。
 * - 不给 `at` → 清空全部（一键全展开，expand 默认）。
 */
export function removeSummarizedRange(
  ranges: readonly SummarizedRange[] | undefined,
  at?: number,
): SummarizedRange[] {
  if (!ranges || ranges.length === 0) return [];
  if (at === undefined || !Number.isInteger(at)) return [];
  return ranges.filter((r) => !(at >= r.fromIdx && at <= r.toIdx));
}

/**
 * 通用折叠投影：把 items 按 ranges 投影成渲染单元 —— 落在某段内的连续 items 折成一条
 * `renderSummary`，段外 items 走 `renderItem`。纯函数，不改 items / ranges。
 *
 * 泛型 over「item → 渲染单元」：self 视角 `T=ProcessEvent, R=LlmInputItem`，
 * peer 视角 `T=ThreadMessage, R=XmlNode`。
 */
export function projectSummarizedRanges<T, R>(
  items: readonly T[],
  ranges: readonly SummarizedRange[] | undefined,
  renderItem: (item: T, idx: number) => R[],
  renderSummary: (range: SummarizedRange, foldedCount: number) => R[],
): R[] {
  const norm = normalizeSummarizedRanges(ranges, items.length);
  if (norm.length === 0) {
    return items.flatMap((it, i) => renderItem(it, i));
  }
  const out: R[] = [];
  let i = 0;
  let ri = 0;
  while (i < items.length) {
    const range = norm[ri];
    if (range && i === range.fromIdx) {
      out.push(...renderSummary(range, range.toIdx - range.fromIdx + 1));
      i = range.toIdx + 1;
      ri++;
      continue;
    }
    out.push(...renderItem(items[i]!, i));
    i++;
  }
  return out;
}
