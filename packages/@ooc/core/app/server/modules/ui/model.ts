import { t } from "elysia";

export const treeQuery = t.Object({
  // R7-4（2026-05-25）：加 "pools"，弥补 2026-05-23 三分落地后 API 漂移
  scope: t.Union([t.Literal("world"), t.Literal("flows"), t.Literal("stones"), t.Literal("pools")]),
  path: t.Optional(t.String()),
});

export const fileQuery = t.Object({
  path: t.String(),
});

export const anyFileQuery = t.Object({
  path: t.String(),
  /** 可选最大字节数(默认 256KB),超过则截断返回 truncated=true。 */
  maxBytes: t.Optional(t.Number()),
});

/**
 * Tree 浏览 scope union（与 2026-05-23 三分对齐；R7-4 补 "pools"）。
 *
 * - "world":  整个 OOC world 根（含 stones/ / pools/ / flows/）
 * - "stones": 设计层（metaprog branches + objects/）
 * - "pools":  事实层（per-Object 与 World 级共享数据）
 * - "flows":  运行层（session 级临时数据）
 */
export type TreeScope = "world" | "flows" | "stones" | "pools";

export type UiTreeNode = {
  name: string;
  type: "directory" | "file";
  path: string;
  size?: number;
  marker?: "flow" | "stone" | "pool";
  children?: UiTreeNode[];
};

