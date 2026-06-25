/**
 * extendClass —— OOC class 继承的可选编译期 helper（裁决 D5）。
 *
 * 重要：**只支持 executable.methods 一档 method-level merge**（按 method name，子覆盖父，
 * 整 ObjectMethod 引用保留含 route/intents/schema/description 等所有字段）。
 *
 * 不为 readable / persistable / visible / thinkable 提供专用合并语义——
 * 这几维 spread 整模块或子手写 `[...parent.window, my]` 数组拼接即可。
 *
 * **扩字段必走新 issue**（防滑坡）—— 这条限制刻意写死，与 issue
 * 2026-06-25-inheritance-via-source-import-spread.md 裁决 D5 对齐。
 *
 * 不强制使用：子完全可手写 `{ ...parentClass, id: "child" }` 替代。OOC 不推荐
 * 任何一种特定继承合并语义；cookbook 平等展示「无 index.ts / 手写 spread / extendClass」三种范式。
 */
import type { OocClass } from "./ooc-class.js";
import type { ObjectMethod, ExecutableModule } from "../types/index.js";

export function extendClass<Data = any, Win = any>(
  parent: OocClass<Data, Win>,
  overrides: Partial<OocClass<Data, Win>> & { id: string },
): OocClass<Data, Win> {
  const out: OocClass<Data, Win> = { ...parent, ...overrides };
  if (overrides.executable && parent.executable) {
    out.executable = mergeExecutable(parent.executable, overrides.executable);
  }
  return out;
}

function mergeExecutable<Data>(
  parent: ExecutableModule<Data>,
  child: ExecutableModule<Data>,
): ExecutableModule<Data> {
  const byName = new Map<string, ObjectMethod<Data>>();
  for (const m of parent.methods) byName.set(m.name, m);
  for (const m of child.methods) byName.set(m.name, m); // 子覆盖父
  return { methods: [...byName.values()] };
}
