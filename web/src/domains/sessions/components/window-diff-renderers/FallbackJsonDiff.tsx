/**
 * FallbackJsonDiff — 通用 JSON tree diff，作为：
 *   1. 未注册 type 的兜底渲染
 *   2. 具体 renderer 抛错时的兜底（DiffRendererErrorBoundary 内部）
 *
 * 实现取舍：
 *   - 不引入 jsondiffpatch 等第三方库；自己写 ~80 行递归 diff
 *   - 字段级标 added / removed / changed / unchanged 四色
 *   - 嵌套对象用缩进显示；数组按 index 配对（粗略，但够 fallback 用）
 *   - 字符串值过长（>200 chars）只显示 preview，避免页面被撑爆
 *
 * 视觉编码（与 styles.css `.diff-renderer-*` 系列保持一致；本文件不引入新 CSS class）：
 *   - added    → 绿底
 *   - removed  → 红底 + strike
 *   - changed  → 黄底
 *   - unchanged→ 普通灰
 */

import type { ReactNode } from "react";
import type { WindowDiffRendererProps } from "./registry";

type DiffStatus = "added" | "removed" | "changed" | "unchanged";

const MAX_VALUE_PREVIEW = 200;

function classifyType(v: unknown): "primitive" | "array" | "object" | "null" {
  if (v === null || v === undefined) return "null";
  if (Array.isArray(v)) return "array";
  if (typeof v === "object") return "object";
  return "primitive";
}

function formatPrimitive(v: unknown): string {
  if (v === null) return "null";
  if (v === undefined) return "undefined";
  if (typeof v === "string") {
    if (v.length > MAX_VALUE_PREVIEW)
      return JSON.stringify(v.slice(0, MAX_VALUE_PREVIEW)) + " …";
    return JSON.stringify(v);
  }
  return String(v);
}

function statusBg(status: DiffStatus): string {
  switch (status) {
    case "added":
      return "rgba(216, 248, 232, .55)";
    case "removed":
      return "rgba(254, 226, 226, .55)";
    case "changed":
      return "rgba(253, 233, 214, .55)";
    case "unchanged":
      return "transparent";
  }
}

function statusLabel(status: DiffStatus): string {
  switch (status) {
    case "added":
      return "+";
    case "removed":
      return "−";
    case "changed":
      return "~";
    case "unchanged":
      return " ";
  }
}

function lineStyle(status: DiffStatus): React.CSSProperties {
  return {
    backgroundColor: statusBg(status),
    padding: "1px 6px",
    borderRadius: 3,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    fontSize: 12,
    lineHeight: "18px",
    textDecoration: status === "removed" ? "line-through" : undefined,
    whiteSpace: "pre-wrap",
    wordBreak: "break-all",
  };
}

function renderLine(
  key: string,
  path: string,
  status: DiffStatus,
  prevValue: unknown,
  curValue: unknown,
  depth: number,
): ReactNode {
  const indent = "  ".repeat(depth);
  let valueRepr: string;
  if (status === "added") {
    valueRepr = formatPrimitive(curValue);
  } else if (status === "removed") {
    valueRepr = formatPrimitive(prevValue);
  } else if (status === "changed") {
    valueRepr = `${formatPrimitive(prevValue)}  →  ${formatPrimitive(curValue)}`;
  } else {
    valueRepr = formatPrimitive(curValue);
  }
  return (
    <div
      key={key}
      style={lineStyle(status)}
      data-diff-status={status}
      data-diff-path={path}
    >
      <span style={{ color: "#888", marginRight: 4 }}>{statusLabel(status)}</span>
      <span>{indent}</span>
      <span style={{ color: "#1e3a8a", fontWeight: 500 }}>{path.split(".").pop() || path}</span>
      <span style={{ color: "#888" }}>: </span>
      <span>{valueRepr}</span>
    </div>
  );
}

function diffNode(
  path: string,
  key: string,
  prev: unknown,
  cur: unknown,
  depth: number,
  // status 来自外层（added/removed）时强制覆盖；undefined 则按相等性推断
  forceStatus: DiffStatus | undefined,
): ReactNode[] {
  const acc: ReactNode[] = [];
  const prevType = classifyType(prev);
  const curType = classifyType(cur);

  // 1. 类型/分支处理：嵌套对象/数组 → 递归；否则按 primitive 渲染
  const isContainer =
    (prevType === "object" || prevType === "array" || prevType === "null") &&
    (curType === "object" || curType === "array" || curType === "null") &&
    (prevType !== "null" || curType !== "null");

  if (isContainer && (prevType === "array" || curType === "array")) {
    // 数组：按 index 配对
    const prevArr = Array.isArray(prev) ? prev : [];
    const curArr = Array.isArray(cur) ? cur : [];
    const maxLen = Math.max(prevArr.length, curArr.length);
    // 头行（数组名）
    let headStatus: DiffStatus =
      forceStatus ??
      (prevArr.length === curArr.length ? "unchanged" : "changed");
    if (forceStatus === undefined && prevArr === cur) headStatus = "unchanged";
    acc.push(
      renderLine(
        `${path}#head`,
        path || key,
        headStatus,
        `array(${prevArr.length})`,
        `array(${curArr.length})`,
        depth,
      ),
    );
    for (let i = 0; i < maxLen; i++) {
      const ip = prevArr[i];
      const ic = curArr[i];
      const childPath = `${path}[${i}]`;
      const childForce: DiffStatus | undefined =
        forceStatus ??
        (i >= prevArr.length
          ? "added"
          : i >= curArr.length
            ? "removed"
            : undefined);
      acc.push(...diffNode(childPath, String(i), ip, ic, depth + 1, childForce));
    }
    return acc;
  }

  if (isContainer && (prevType === "object" || curType === "object")) {
    const prevObj = (prev ?? {}) as Record<string, unknown>;
    const curObj = (cur ?? {}) as Record<string, unknown>;
    const allKeys = new Set<string>();
    for (const k of Object.keys(prevObj)) allKeys.add(k);
    for (const k of Object.keys(curObj)) allKeys.add(k);
    // 头行
    const headStatus: DiffStatus =
      forceStatus ??
      (JSON.stringify(prevObj) === JSON.stringify(curObj) ? "unchanged" : "changed");
    acc.push(
      renderLine(
        `${path}#head`,
        path || key || "(root)",
        headStatus,
        "object",
        "object",
        depth,
      ),
    );
    const sortedKeys = Array.from(allKeys).sort();
    for (const k of sortedKeys) {
      const ip = prevObj[k];
      const ic = curObj[k];
      const childPath = path ? `${path}.${k}` : k;
      const childForce: DiffStatus | undefined =
        forceStatus ??
        (!(k in prevObj)
          ? "added"
          : !(k in curObj)
            ? "removed"
            : undefined);
      acc.push(...diffNode(childPath, k, ip, ic, depth + 1, childForce));
    }
    return acc;
  }

  // 2. primitive / null 单行
  let status: DiffStatus;
  if (forceStatus) {
    status = forceStatus;
  } else if (prev === undefined && cur !== undefined) {
    status = "added";
  } else if (cur === undefined && prev !== undefined) {
    status = "removed";
  } else if (JSON.stringify(prev) === JSON.stringify(cur)) {
    status = "unchanged";
  } else {
    status = "changed";
  }
  acc.push(renderLine(path || key, path || key, status, prev, cur, depth));
  return acc;
}

export function FallbackJsonDiff(props: WindowDiffRendererProps) {
  const { previous, current, windowType, windowId } = props;
  const isAdded = previous === undefined && current !== undefined;
  const isRemoved = current === undefined && previous !== undefined;
  const forceStatus: DiffStatus | undefined = isAdded
    ? "added"
    : isRemoved
      ? "removed"
      : undefined;

  const lines = diffNode("", windowId, previous, current, 0, forceStatus);

  return (
    <div
      className="window-diff-fallback-json"
      data-testid={`window-diff-fallback-${windowId}`}
      data-window-type={windowType}
      style={{
        border: "1px solid var(--border)",
        borderRadius: 6,
        padding: 6,
        background: "var(--background2)",
        maxHeight: 480,
        overflow: "auto",
      }}
    >
      <div
        className="muted small"
        style={{ marginBottom: 4, fontSize: 11, padding: "0 4px" }}
      >
        JSON tree diff · type: <code>{windowType}</code>
      </div>
      {lines.length === 0 && (
        <div className="muted small">(no diff content)</div>
      )}
      {lines}
    </div>
  );
}
