/**
 * behavior.ts — 活路径上「沿 base prototype 链解析 window 行为 aspect」的解析层（OOC-4 L4.1）。
 *
 * 接 **renderXml + basicKnowledge + method + onClose + compressView** 五个 aspect：
 * - method 解析（lookupMethodEntry/callMethod/renderMethodsNode）—— L4.2；
 * - onClose / compressView 沿链解析（OOC-4 L6c-1）：A 类（knowledge/search/file/skill_index）
 *   把 hook 实现搬进 base proto 的 window 定义，活路径 `resolveOnClose/resolveCompressView ?? registry`
 *   兜底；do/talk 无 base proto，resolveX 返 undefined → 自动回退 registry（留到 L6c-2/3 擦除）。
 *
 * 解析语义（plan D2 graceful dispatch）：
 *   protoId = builtinProtoId(window.type)
 *   - proto 不在 base registry（do/talk/feishu_* 等 B 类）→ undefined（caller 回退 registry）
 *   - 在 base registry：沿 self.md frontmatter extends 链 walk，第一个提供该 aspect 的 def 命中；
 *     全链 miss（program 等无 executable 的骨架）→ undefined（caller 回退 registry）
 *
 * proto def 加载（plan D3）：stat-before-import（fail-loud，**不吞 broken import**）。
 * 动态 import 对「文件不存在」与「文件存在但内部 import 损坏」同抛 ERR_MODULE_NOT_FOUND，
 * 故先 stat `executable/index.ts`：ENOENT → 骨架（undefined，正常回退）；存在则 import，
 * 任何 import 错误向上抛（对齐 server/loader.ts:8-16 既有范式，遵守 silent-swallow ban）。
 *
 * 缓存（plan D6）：base registry module-level 单次缓存；proto def 按 dir 缓存。
 * 提供 clearBehaviorCache() 测试钩子（对齐 server/loader.ts:74）。
 */

import { stat } from "node:fs/promises";
import { join } from "node:path";
import { loadBuiltinRegistry } from "../../../extendable/base/index.js";
import { builtinProtoId, type ObjectRegistry } from "../../prototype/index.js";
import type { ObjectWindowDefinition } from "../../server/window-types.js";
import type { MethodEntry } from "./method-types.js";
import type { RenderHook, OnCloseHook, CompressViewHook } from "./registry.js";

let _registry: Promise<ObjectRegistry> | undefined;
function baseRegistry(): Promise<ObjectRegistry> {
  if (!_registry) _registry = loadBuiltinRegistry();
  return _registry;
}

const _defCache = new Map<string, Promise<ObjectWindowDefinition | undefined>>();
async function loadPrototypeDefinition(dir: string): Promise<ObjectWindowDefinition | undefined> {
  let p = _defCache.get(dir);
  if (!p) {
    p = (async () => {
      const file = join(dir, "executable", "index.ts");
      try {
        await stat(file); // 存在性探测：ENOENT → 骨架原型，正常回退
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
        throw e;
      }
      // 文件存在 → import；import 错误向上抛（fail-loud，不静默吞 broken transitive import）
      const mod = await import(file);
      return (mod.window ?? undefined) as ObjectWindowDefinition | undefined;
    })();
    _defCache.set(dir, p);
  }
  return p;
}

/**
 * 沿 extends 链 resolve 某 aspect；proto 不在 base registry 或链全 miss → undefined（回退 registry）。
 *
 * 不复用 L2 同步 resolveAlongChain——probe 需 async load proto def；手动沿 rec.extends walk，
 * 同语义 + visited 防环（base registry build 已校验无环，这里 defense-in-depth）。
 */
async function resolveAspect<T>(
  type: string,
  pick: (def: ObjectWindowDefinition) => T | undefined,
): Promise<T | undefined> {
  const reg = await baseRegistry();
  const protoId = builtinProtoId(type);
  if (!reg.has(protoId)) return undefined;
  let curId: string | null = protoId;
  const seen = new Set<string>();
  while (curId !== null && !seen.has(curId)) {
    seen.add(curId);
    const rec = reg.get(curId);
    if (!rec) break;
    const def = await loadPrototypeDefinition(rec.dir);
    if (def) {
      const v = pick(def);
      if (v !== undefined) return v;
    }
    curId = rec.extends;
  }
  return undefined;
}

/** 沿 base 原型链解析 renderXml；链未提供 → undefined（caller 回退 registry）。 */
export async function resolveRenderXml(type: string): Promise<RenderHook | undefined> {
  return resolveAspect(type, (d) => d.renderXml);
}

/**
 * 沿 base 原型链解析 onClose（OOC-4 L6c-1）；链未提供 → undefined（caller 回退 registry）。
 *
 * veto 语义（返 false 拒绝 close）跨链保持：manager.close 用
 * `(await resolveOnClose(type)) ?? def.onClose` 兜底，链 miss 时走 registry 的 def.onClose，
 * 语义完全相同。非 base type（do/talk）或链上无 executable → undefined → 回退 registry。
 */
export async function resolveOnClose(type: string): Promise<OnCloseHook | undefined> {
  return resolveAspect(type, (d) => d.onClose);
}

/**
 * 沿 base 原型链解析 compressView（OOC-4 L6c-1）；链未提供 → undefined（caller 回退 registry）。
 *
 * render.ts 在 compressLevel ≥ 1 时用 `(await resolveCompressView(type)) ?? def.compressView`
 * 兜底；链 miss（do/talk 无 base proto，或链上无 compressView）→ 回退 registry 的 def.compressView。
 */
export async function resolveCompressView(type: string): Promise<CompressViewHook | undefined> {
  return resolveAspect(type, (d) => d.compressView);
}

/**
 * 沿 base 原型链解析**单个** method（OOC-4 L4.2 / plan D1）。
 *
 * 语义同 resolveAspect：第一个提供 `methods[name]` 的 def 命中（子优先），全链 miss → undefined。
 * caller（manager.lookupMethodEntry / self.callMethod / permissions / synthesizer.lookupFormEntry）
 * 用 `(await resolveMethod(type, name)) ?? registry.methods[name]` 兜底。
 * 非 base type（do/talk/custom 等）或链上无 executable → undefined → 回退 registry。
 */
export async function resolveMethod(
  type: string,
  name: string,
): Promise<MethodEntry | undefined> {
  return resolveAspect(type, (d) => d.methods?.[name]);
}

/**
 * 沿 base 原型链解析**完整** method 集合（OOC-4 L4.2 / plan D1）。
 *
 * 与 resolveMethod 不同：需要合并整条链（root→own，子覆盖父），并区分两种「空」：
 * - 链上**有**至少一个 proto 提供了 `executable`（methods 字段存在，哪怕是 `{}`）→ 返回 merged
 *   （包括 `{}`，表示「已转写但本就无 method」，caller 用之、不回退 registry）。
 * - 链上**没有**任何 proto 提供 executable（program 等骨架未转写、或非 base type）→ 返回 undefined
 *   （sawExecutable=false），caller 回退 registry 的真方法表。
 *
 * 用于 render.renderMethodsNode / api.list-window-types catalog（需要遍历整张 method 表），
 * 不能用「单点 resolveMethod 找不到就回退」——那会在 base 已转写但缺某 method 时错误回退。
 */
export async function resolveAllMethods(
  type: string,
): Promise<Record<string, MethodEntry> | undefined> {
  const reg = await baseRegistry();
  const protoId = builtinProtoId(type);
  if (!reg.has(protoId)) return undefined;

  // own→root 收集每层 def；后续 root→own 合并（子覆盖父）。
  let curId: string | null = protoId;
  const seen = new Set<string>();
  const defsOwnToRoot: ObjectWindowDefinition[] = [];
  while (curId !== null && !seen.has(curId)) {
    seen.add(curId);
    const rec = reg.get(curId);
    if (!rec) break;
    const def = await loadPrototypeDefinition(rec.dir);
    if (def) defsOwnToRoot.push(def);
    curId = rec.extends;
  }

  let sawExecutable = false;
  const merged: Record<string, MethodEntry> = {};
  // root→own 合并：reverse 后逐层 Object.assign，子层覆盖父层同名 method。
  for (const def of defsOwnToRoot.slice().reverse()) {
    if (def.methods !== undefined) {
      sawExecutable = true;
      Object.assign(merged, def.methods);
    }
  }
  return sawExecutable ? merged : undefined;
}

/**
 * 沿 base 原型链解析 basicKnowledge；链未提供 → undefined（caller 回退 registry）。
 * basicKnowledge 类型是 string | ((ctx)=>string)；这里只取 string 形态（动态函数留 L4.2+）。
 */
export async function resolveBasicKnowledge(type: string): Promise<string | undefined> {
  return resolveAspect(type, (d) => (typeof d.basicKnowledge === "string" ? d.basicKnowledge : undefined));
}

/** 测试钩子：清空 base registry + proto def 缓存。 */
export function clearBehaviorCache(): void {
  _registry = undefined;
  _defCache.clear();
}
