/**
 * 对象自定义 UI 注册表
 *
 * 构建时通过 import.meta.glob 扫描所有对象的 ui/index.tsx。
 * 对象可以在 .ooc/stones/{name}/ui/index.tsx 中导出自定义 UI 组件。
 */

import type { StoneData } from "../api/types";

/** 自定义 UI 组件的 props */
export interface ObjectUIProps {
  objectName: string;
  stone: StoneData;
}

const modules = import.meta.glob<{ default: React.ComponentType<ObjectUIProps> }>(
  "../../../stones/*/ui/index.tsx",
  { eager: true },
);

/** 对象名 → 自定义 UI 组件 */
export const objectUIs: Record<string, React.ComponentType<ObjectUIProps>> = {};

for (const [path, mod] of Object.entries(modules)) {
  /* 从路径提取对象名：../../../stones/{name}/ui/index.tsx */
  const match = path.match(/stones\/([^/]+)\/ui\/index\.tsx$/);
  const name = match?.[1];
  if (name && mod.default) {
    objectUIs[name] = mod.default;
  }
}

/** 检查对象是否有自定义 UI */
export function hasCustomUI(objectName: string): boolean {
  return objectName in objectUIs;
}
