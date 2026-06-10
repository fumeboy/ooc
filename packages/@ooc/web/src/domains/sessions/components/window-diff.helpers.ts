/**
 * window-diff.helpers — Round 9 E3 Loop Time Machine.
 *
 * 把"当前 loop 的 windowsSnapshot"vs"上一 loop 的 windowsSnapshot"算成一份带 status 的
 * diff 表，供 LoopDiffView 渲染。Hash 由后端 E2 写入 `loop_NNNN.meta.json` 的
 * `windowsSnapshot[*].contentHash`；前端只做集合 diff，不重新计算 hash。
 *
 * 4 态语义（与 design §1.3 对齐）：
 *   - added      : 在 current 出现、previous 没有 → 新窗口
 *   - removed    : 在 previous 有、current 没了   → 已 close
 *   - changed    : 同 id + hash 不同              → 内容变更
 *   - unchanged  : 同 id + hash 相同              → 不变
 *
 * 边界：
 *   - current undefined（loop N 后端没写 snapshot 字段）→ 返回空数组；UI 上层显示 "no snapshot data"
 *   - previous undefined（loop 0 / 老 loop 没 snapshot）→ current 全部记 "added"
 *   - 两边都 undefined → 空数组
 *
 * 不做的事：
 *   - 不解析 / 关心 hash 算法（design §B：Bun.hash + stripVolatile 是后端职责）
 *   - 不做 deep field-level diff（design §C：内容变了就是 changed，不再细分哪个字段）
 *   - 不依赖排序：返回结果按"current 中出现的顺序"+ removed 追加在末尾（稳定可读）
 */

/**
 * WindowSnapshotEntry — 与后端 `LlmLoopDebugMetaRecord.windowsSnapshot[*]` 的形态镜像
 * （前端重声明避免 cross-package 依赖；与 design §3.2 / E2 sub agent 的实现对齐）。
 *
 * E2 数据未到时：snapshot 字段不存在 → computeWindowDiff 直接走 undefined 分支 → UI 显示
 * "no snapshot data"，不会炸。
 */
/**
 * Round 10 F3 — type-dispatch window diff renderer 协议扩展：
 * file_window 的 prev/current 内容由 backend F2 直接附在 snapshot entry 上，
 * 避免前端跨 loop 重新 fetch input.json + 拼装。
 *
 * F2 未到位时（fileDiff 字段缺失）→ FileWindowDiff 软退化：显示 path link 提示
 * "file diff payload not yet available"。
 */
export interface FileDiffData {
  previousContent: string;
  currentContent: string;
  path: string;
  /** 二进制文件 → 不应做行级 diff；显示提示。 */
  isBinary?: boolean;
  /** 超过阈值（如 200KB）→ 不应做行级 diff；显示提示 + path。 */
  tooLarge?: boolean;
}

export interface WindowSnapshotEntry {
  id: string;
  class: string;
  contentHash: string;
  parentWindowId?: string;
  status?: string;
  compressLevel?: 0 | 1 | 2;
  /** 后端可能附 summary 供 UI 显示，避免 expand 才知道 window 在讲什么。 */
  summary?: string;
  /**
   * Round 10 F3：file_window 类型专属。
   * 与 backend F2 sub agent 实现的 shape 对齐；F2 未到位时 undefined → FileWindowDiff 软退化。
   */
  fileDiff?: FileDiffData;
}

export type WindowDiffStatus = "added" | "changed" | "removed" | "unchanged";

export interface WindowDiffEntry {
  id: string;
  /** 显示用 type label —— 取 current.class 或 previous.class（removed 时 fallback）。 */
  class: string;
  status: WindowDiffStatus;
  /** current loop 的 entry；removed 时 undefined。 */
  current?: WindowSnapshotEntry;
  /** previous loop 的 entry；added 时 undefined。 */
  previous?: WindowSnapshotEntry;
}

/**
 * 计算当前 loop 与上一 loop 的 window-level diff。
 *
 * 返回顺序：先 current 中出现的顺序（保留视觉稳定性，loop 切换不重排），
 * 再追加 previous 里被删的 (removed) entries。
 */
export function computeWindowDiff(
  current: WindowSnapshotEntry[] | undefined,
  previous: WindowSnapshotEntry[] | undefined,
): WindowDiffEntry[] {
  // current 完全没有 snapshot 数据 → 不能 diff（不是空数组的意思；是字段缺失）
  if (!Array.isArray(current)) return [];

  const previousList = Array.isArray(previous) ? previous : [];
  const previousById = new Map<string, WindowSnapshotEntry>();
  for (const w of previousList) {
    if (w && typeof w.id === "string") previousById.set(w.id, w);
  }

  const seenIds = new Set<string>();
  const result: WindowDiffEntry[] = [];

  for (const cur of current) {
    if (!cur || typeof cur.id !== "string") continue;
    seenIds.add(cur.id);
    const prev = previousById.get(cur.id);

    if (!prev) {
      // previous 完全没 snapshot（loop 0 或老 loop）→ 全 added
      // previous 有 snapshot 但缺这个 id → added
      result.push({
        id: cur.id,
        class: cur.class,
        status: "added",
        current: cur,
      });
      continue;
    }

    if (cur.contentHash === prev.contentHash) {
      result.push({
        id: cur.id,
        class: cur.class,
        status: "unchanged",
        current: cur,
        previous: prev,
      });
    } else {
      result.push({
        id: cur.id,
        class: cur.class,
        status: "changed",
        current: cur,
        previous: prev,
      });
    }
  }

  // previous 中 current 没有的 → removed
  for (const prev of previousList) {
    if (!prev || typeof prev.id !== "string") continue;
    if (seenIds.has(prev.id)) continue;
    result.push({
      id: prev.id,
      class: prev.class,
      status: "removed",
      previous: prev,
    });
  }

  return result;
}

/**
 * UI 辅助：把 status 映射成视觉 token —— icon / label / className 后缀。
 *
 * 颜色编码与 design §5 对齐：
 *  - added     → 绿色 (added)
 *  - changed   → 橙色 (changed)
 *  - removed   → 灰化 + strike-through
 *  - unchanged → 普通灰
 */
export function describeDiffStatus(status: WindowDiffStatus): {
  icon: string;
  label: string;
  /** className suffix（与 styles.css `.window-diff-row-<suffix>` 对齐）。 */
  className: string;
} {
  switch (status) {
    case "added":
      return { icon: "🆕", label: "added", className: "added" };
    case "changed":
      return { icon: "✏️", label: "changed", className: "changed" };
    case "removed":
      return { icon: "🗑️", label: "removed", className: "removed" };
    case "unchanged":
      return { icon: "·", label: "unchanged", className: "unchanged" };
  }
}
