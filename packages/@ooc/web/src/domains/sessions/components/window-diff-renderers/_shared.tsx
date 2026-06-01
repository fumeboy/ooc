/**
 * _shared — diff renderer 通用 util / 视觉组件。
 *
 * 不外露给 LoopDiffView；renderer 内部引用。
 *
 * 视觉编码（与 FallbackJsonDiff / styles.css 对齐）：
 *   - added    → 绿底
 *   - removed  → 红底 + strike
 *   - changed  → 黄底
 *   - unchanged→ 普通灰
 */

import type { CSSProperties, ReactNode } from "react";

export type DiffStatus = "added" | "removed" | "changed" | "unchanged";

export function statusBg(status: DiffStatus): string {
  switch (status) {
    case "added":
      return "rgba(216, 248, 232, .45)";
    case "removed":
      return "rgba(254, 226, 226, .45)";
    case "changed":
      return "rgba(253, 233, 214, .45)";
    case "unchanged":
      return "transparent";
  }
}

export function statusBorder(status: DiffStatus): string {
  switch (status) {
    case "added":
      return "#b8efd5";
    case "removed":
      return "#fca5a5";
    case "changed":
      return "#f1c98e";
    case "unchanged":
      return "var(--border)";
  }
}

export function rowStyle(status: DiffStatus): CSSProperties {
  return {
    padding: "4px 8px",
    margin: "2px 0",
    borderRadius: 4,
    border: `1px solid ${statusBorder(status)}`,
    backgroundColor: statusBg(status),
    fontSize: 12,
    lineHeight: "18px",
    textDecoration: status === "removed" ? "line-through" : undefined,
  };
}

export function StatusBadge({ status }: { status: DiffStatus }) {
  const labels: Record<DiffStatus, string> = {
    added: "+ added",
    removed: "− removed",
    changed: "~ changed",
    unchanged: "· unchanged",
  };
  const colors: Record<DiffStatus, string> = {
    added: "#238d61",
    removed: "#b91c1c",
    changed: "#a35a14",
    unchanged: "var(--muted-foreground)",
  };
  return (
    <span
      className="diff-renderer-status-badge"
      style={{
        fontSize: 10,
        padding: "1px 6px",
        borderRadius: 3,
        color: colors[status],
        border: `1px solid ${statusBorder(status)}`,
        background: "var(--background)",
        marginLeft: 6,
        fontWeight: 500,
      }}
    >
      {labels[status]}
    </span>
  );
}

/** 比较两个 primitive；返回 "unchanged" | "changed" | "added" | "removed"。 */
export function comparePrimitive(prev: unknown, cur: unknown): DiffStatus {
  if (prev === undefined && cur !== undefined) return "added";
  if (cur === undefined && prev !== undefined) return "removed";
  if (JSON.stringify(prev) === JSON.stringify(cur)) return "unchanged";
  return "changed";
}

/** 在对象上读字符串字段，失败返回 fallback。 */
export function readString(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const v = (value as Record<string, unknown>)[key];
  return typeof v === "string" ? v : undefined;
}

export function readArray(value: unknown, key: string): unknown[] {
  if (!value || typeof value !== "object") return [];
  const v = (value as Record<string, unknown>)[key];
  return Array.isArray(v) ? v : [];
}

export function readObject(
  value: unknown,
  key: string,
): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const v = (value as Record<string, unknown>)[key];
  if (v && typeof v === "object" && !Array.isArray(v))
    return v as Record<string, unknown>;
  return undefined;
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function Section({
  title,
  children,
  testId,
}: {
  title: ReactNode;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <div
      data-testid={testId}
      style={{
        marginBottom: 8,
        border: "1px solid var(--border)",
        borderRadius: 6,
        padding: 6,
        background: "var(--background2)",
      }}
    >
      <div
        className="muted small"
        style={{ fontSize: 11, fontWeight: 500, marginBottom: 4 }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

/** 字段级 diff 一栏：[key, prev → cur]。 */
export function FieldDiffLine({
  label,
  prev,
  cur,
  status: forced,
}: {
  label: string;
  prev: unknown;
  cur: unknown;
  status?: DiffStatus;
}) {
  const status = forced ?? comparePrimitive(prev, cur);
  let body: ReactNode;
  if (status === "added") body = <code>{JSON.stringify(cur)}</code>;
  else if (status === "removed") body = <code>{JSON.stringify(prev)}</code>;
  else if (status === "changed")
    body = (
      <>
        <code>{JSON.stringify(prev)}</code>
        <span style={{ margin: "0 6px" }}>→</span>
        <code>{JSON.stringify(cur)}</code>
      </>
    );
  else body = <code>{JSON.stringify(cur)}</code>;

  return (
    <div style={rowStyle(status)} data-diff-status={status}>
      <strong style={{ marginRight: 6 }}>{label}:</strong>
      {body}
      <StatusBadge status={status} />
    </div>
  );
}
