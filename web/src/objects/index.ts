/**
 * 对象自定义 View 注册表
 *
 * 构建时通过 import.meta.glob 扫描所有对象的 views/{viewName}/frontend.tsx。
 * 对象可以在 stones/{name}/views/{viewName}/frontend.tsx 中导出自定义 View 组件。
 *
 * - 若对象存在任一 view（views/*\/frontend.tsx），视为有"主 View"
 * - 若对象存在名为 `main` 的 view（views/main/frontend.tsx），优先作为默认入口
 * - 否则取扫描顺序第一个 view 作为入口
 *
 * @ref docs/超powers/specs/2026-04-21-trait-namespace-views-and-http-methods-design.md#4.3
 */

import type { StoneData } from "../api/types";

/** 自定义 View 组件的 props */
export interface ObjectUIProps {
  objectName: string;
  stone: StoneData;
}

/** 构建时扫描所有 stone 的 views/*\/frontend.tsx */
const modules = import.meta.glob<{ default: React.ComponentType<any> }>(
  "../../../stones/*/views/*/frontend.tsx",
  { eager: true },
);

/** 对象名 → 该对象所有 views 的映射：{ [viewName]: Component } */
export const objectViews: Record<string, Record<string, React.ComponentType<any>>> = {};

for (const [path, mod] of Object.entries(modules)) {
  /* 从路径提取对象名和 view 名：../../../stones/{name}/views/{viewName}/frontend.tsx */
  const match = path.match(/stones\/([^/]+)\/views\/([^/]+)\/frontend\.tsx$/);
  const name = match?.[1];
  const viewName = match?.[2];
  if (name && viewName && mod.default) {
    if (!objectViews[name]) objectViews[name] = {};
    objectViews[name][viewName] = mod.default;
  }
}

/** 获取对象的默认 view 组件（main 优先，否则取第一个） */
export function getDefaultView(objectName: string): React.ComponentType<any> | null {
  const views = objectViews[objectName];
  if (!views) return null;
  if (views["main"]) return views["main"]!;
  const keys = Object.keys(views).sort();
  const first = keys[0];
  return first ? (views[first] ?? null) : null;
}

/** 检查对象是否有自定义 view */
export function hasCustomUI(objectName: string): boolean {
  const views = objectViews[objectName];
  return !!views && Object.keys(views).length > 0;
}

/** 获取对象的所有 view 名称列表 */
export function listObjectViews(objectName: string): string[] {
  const views = objectViews[objectName];
  if (!views) return [];
  return Object.keys(views).sort();
}
