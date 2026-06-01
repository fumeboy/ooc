/**
 * RelationOverlay — D4: 选中某 thread 时画出与其它 thread 的关系连线。
 *
 * 设计参考: docs/2026-05-26-session-threads-index-design.md §5.4。
 *
 * 关系视觉：
 *   - creator/parent   — 蓝色 solid + arrow (child → parent)
 *   - talk peer        — 绿色 dashed + arrow (caller → callee)
 *   - share lent_out   — 橙色 dashed + arrow (lender → borrower)
 *   - share ref holding— 橙色 dashed + arrow (owner → holder)
 *
 * 实现:
 *   - useLayoutEffect 计算 ThreadNode 的 getBoundingClientRect, 减去 container 的偏移
 *   - SVG absolute 覆盖整个 columns 容器
 *   - 未选中时返回 null —— 不画任何线（避免视觉杂乱）
 *   - 节点不存在（target 跨 session / 还没渲染）时静默跳过
 *
 * MVP 边界（design §5.4 末段）:
 *   - 不做动画 / 不优化交叉避让
 *   - resize 监听 + 节点 mount/unmount 触发的 recompute 用一个 trigger state 配 polling
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ListThreadsItem } from "../types";

interface RelationOverlayProps {
  /** 容器 ref — overlay 用相对其的坐标系画 */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** 当前所有 items (用来查找选中 thread 的关系) */
  items: ListThreadsItem[];
  /** 选中的 thread 标识；未选中时不画 */
  selected?: { objectId: string; threadId: string };
}

type RelationKind = "parent" | "talk" | "lent" | "holding";

interface Edge {
  fromObjectId: string;
  fromThreadId: string;
  toObjectId: string;
  toThreadId: string;
  kind: RelationKind;
}

interface LineGeom {
  key: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  kind: RelationKind;
}

const KIND_STYLE: Record<RelationKind, { color: string; dashed: boolean }> = {
  parent: { color: "#4561e4", dashed: false },
  talk: { color: "#238d61", dashed: true },
  lent: { color: "#c97a26", dashed: true },
  holding: { color: "#c97a26", dashed: true },
};

export function RelationOverlay({ containerRef, items, selected }: RelationOverlayProps) {
  // 触发 recompute 的 nonce —— resize / 滚动 / items 变化时增加
  const [nonce, setNonce] = useState(0);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [lines, setLines] = useState<LineGeom[]>([]);
  // ResizeObserver 监听容器 + window scroll
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let frame = 0;
    const trigger = () => {
      // rAF 节流 —— 多个 event 合并到一次重算
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setNonce((n) => n + 1));
    };
    let ro: ResizeObserver | undefined;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(trigger);
      ro.observe(container);
    }
    window.addEventListener("resize", trigger);
    container.addEventListener("scroll", trigger, true);
    return () => {
      cancelAnimationFrame(frame);
      ro?.disconnect();
      window.removeEventListener("resize", trigger);
      container.removeEventListener("scroll", trigger, true);
    };
  }, [containerRef]);

  // 主重算: 选中变化 / items 变化 / nonce 变化 时
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || !selected) {
      setLines([]);
      return;
    }
    const cRect = container.getBoundingClientRect();
    const edges = computeEdges(items, selected);
    const geom: LineGeom[] = [];
    for (const e of edges) {
      const fromEl = container.querySelector<HTMLElement>(
        `[data-object-id="${cssEscape(e.fromObjectId)}"][data-thread-id="${cssEscape(e.fromThreadId)}"]`,
      );
      const toEl = container.querySelector<HTMLElement>(
        `[data-object-id="${cssEscape(e.toObjectId)}"][data-thread-id="${cssEscape(e.toThreadId)}"]`,
      );
      if (!fromEl || !toEl) continue;
      const fr = fromEl.getBoundingClientRect();
      const tr = toEl.getBoundingClientRect();
      // 端点取节点 right-center → 另一端节点 left-center (跨栏直观)
      // 同栏（parent-child）则改用 bottom-center → top-center
      const sameColumn = e.fromObjectId === e.toObjectId;
      const x1 = sameColumn ? fr.left + fr.width / 2 - cRect.left : fr.right - cRect.left;
      const y1 = sameColumn ? fr.bottom - cRect.top : fr.top + fr.height / 2 - cRect.top;
      const x2 = sameColumn ? tr.left + tr.width / 2 - cRect.left : tr.left - cRect.left;
      const y2 = sameColumn ? tr.top - cRect.top : tr.top + tr.height / 2 - cRect.top;
      geom.push({
        key: `${e.fromObjectId}:${e.fromThreadId}->${e.toObjectId}:${e.toThreadId}:${e.kind}`,
        x1,
        y1,
        x2,
        y2,
        kind: e.kind,
      });
    }
    setLines(geom);
    setSize({ w: cRect.width, h: cRect.height });
  }, [containerRef, items, selected, nonce]);

  if (!selected || lines.length === 0) return null;

  return (
    <svg
      className="relation-overlay"
      width={size.w}
      height={size.h}
      data-testid="relation-overlay"
      aria-hidden="true"
    >
      <defs>
        {(["parent", "talk", "lent", "holding"] as RelationKind[]).map((k) => (
          <marker
            key={k}
            id={`relation-arrow-${k}`}
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill={KIND_STYLE[k].color} />
          </marker>
        ))}
      </defs>
      {lines.map((ln) => {
        const style = KIND_STYLE[ln.kind];
        return (
          <line
            key={ln.key}
            x1={ln.x1}
            y1={ln.y1}
            x2={ln.x2}
            y2={ln.y2}
            stroke={style.color}
            strokeWidth={1.4}
            strokeDasharray={style.dashed ? "4 3" : undefined}
            markerEnd={`url(#relation-arrow-${ln.kind})`}
            data-relation-kind={ln.kind}
          />
        );
      })}
    </svg>
  );
}

/**
 * 从选中的 thread 出发, 收集所有相关边。
 * 导出供单测断言。
 */
export function computeEdges(
  items: ListThreadsItem[],
  selected: { objectId: string; threadId: string },
): Edge[] {
  const edges: Edge[] = [];
  const self = items.find(
    (i) => i.objectId === selected.objectId && i.threadId === selected.threadId,
  );
  if (!self) return edges;
  // parent 关系 (本 → parent)
  if (self.parentThreadId) {
    edges.push({
      fromObjectId: self.objectId,
      fromThreadId: self.threadId,
      toObjectId: self.objectId,
      toThreadId: self.parentThreadId,
      kind: "parent",
    });
  }
  // creator 关系 (跨 object) —— 不重复画 parent
  if (
    self.creatorObjectId &&
    self.creatorThreadId &&
    !(self.creatorObjectId === self.objectId && self.creatorThreadId === self.parentThreadId)
  ) {
    edges.push({
      fromObjectId: self.objectId,
      fromThreadId: self.threadId,
      toObjectId: self.creatorObjectId,
      toThreadId: self.creatorThreadId,
      kind: "parent",
    });
  }
  // talk peers (本 → callee)
  for (const p of self.talkPeers ?? []) {
    if (!p.targetThreadId) continue;
    edges.push({
      fromObjectId: self.objectId,
      fromThreadId: self.threadId,
      toObjectId: p.targetObjectId,
      toThreadId: p.targetThreadId,
      kind: "talk",
    });
  }
  // lent windows (本 → borrower)
  for (const l of self.shares?.lentOut ?? []) {
    if (!l.borrowerObjectId || !l.borrowerThreadId) continue;
    edges.push({
      fromObjectId: self.objectId,
      fromThreadId: self.threadId,
      toObjectId: l.borrowerObjectId,
      toThreadId: l.borrowerThreadId,
      kind: "lent",
    });
  }
  // ref holding (owner → 本)
  for (const h of self.shares?.holding ?? []) {
    if (!h.ownerObjectId || !h.ownerThreadId) continue;
    edges.push({
      fromObjectId: h.ownerObjectId,
      fromThreadId: h.ownerThreadId,
      toObjectId: self.objectId,
      toThreadId: self.threadId,
      kind: "holding",
    });
  }
  return edges;
}

/**
 * CSS.escape 在测试 / 老浏览器可能不存在；保底用最小白名单转义。
 * objectId / threadId 在 OOC 数据里大多是 `[A-Za-z0-9_-]+`,极少需要转义。
 */
function cssEscape(s: string): string {
  if (typeof (globalThis as { CSS?: { escape?: (s: string) => string } }).CSS?.escape === "function") {
    return (globalThis as { CSS: { escape: (s: string) => string } }).CSS.escape(s);
  }
  return s.replace(/(["\\\][\]()'])/g, "\\$1");
}
