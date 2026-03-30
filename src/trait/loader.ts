/**
 * Trait 加载器 (G3)
 *
 * 从文件系统的 traits/ 目录加载 Trait 定义。
 * 每个 Trait 是一个目录：readme.md（文档/bias）+ 可选 index.ts（方法）。
 *
 * @ref docs/哲学文档/gene.md#G3 — implements — Trait 从文件系统加载（readme.md + index.ts）
 * @ref docs/哲学文档/gene.md#G7 — references — Trait 目录即 Trait 存在
 * @ref src/types/trait.ts — references — TraitDefinition, TraitMethod 类型
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import matter from "gray-matter";
import type { TraitDefinition, TraitMethod, TraitHookEvent, TraitHook } from "../types/index.js";

/**
 * 从单个 trait 目录加载 Trait 定义
 *
 * @param traitDir - trait 目录路径（如 stones/researcher/traits/web_search/）
 * @param traitName - trait 名称
 * @returns TraitDefinition，若目录无效返回 null
 */
export async function loadTrait(traitDir: string, traitName: string): Promise<TraitDefinition | null> {
  if (!existsSync(traitDir)) return null;

  const readmePath = join(traitDir, "readme.md");
  const indexPath = join(traitDir, "index.ts");

  /* 解析 readme.md */
  let readme = "";
  let when: TraitDefinition["when"] = "never";
  let description = "";
  let deps: string[] = [];
  let hooks: TraitDefinition["hooks"];

  if (existsSync(readmePath)) {
    const raw = readFileSync(readmePath, "utf-8");
    const { data, content } = matter(raw);
    readme = content.trim();
    when = typeof data.when === "string" ? data.when : "never";
    description = typeof data.description === "string" ? data.description : "";
    deps = Array.isArray(data.deps) ? data.deps.map(String) : [];
    hooks = parseTraitHooks(data.hooks);
  }

  /* 加载 index.ts 中的方法 */
  let methods: TraitMethod[] = [];
  if (existsSync(indexPath)) {
    methods = await loadTraitMethods(indexPath);
  }

  return { name: traitName, when, description, readme, methods, deps, hooks };
}

/**
 * 从 index.ts 动态加载方法
 *
 * 支持两种格式：
 *
 * 1. 旧格式（结构化导出）：
 * ```
 * export const methods = {
 *   search: { description: "搜索", params: [...], fn: async (ctx, query) => { ... } }
 * };
 * ```
 *
 * 2. 新格式（TSDoc 注释 + 直接导出函数）：
 * ```
 * /** 搜索信息 @param query - 搜索关键词 *\/
 * export async function search(ctx, query) { ... }
 * ```
 * 系统从 TSDoc 注释自动解析 description 和 params。
 */
async function loadTraitMethods(indexPath: string): Promise<TraitMethod[]> {
  try {
    const mod = await import(`${indexPath}?t=${Date.now()}`);

    /* 尝试旧格式：export const methods = {...} */
    const exported = mod.methods as Record<string, unknown> | undefined;
    if (exported && typeof exported === "object") {
      return loadMethodsFromStructured(exported);
    }

    /* 新格式：从导出的函数 + 源码 TSDoc 解析 */
    const source = readFileSync(indexPath, "utf-8");
    const tsDocMap = parseTSDoc(source);
    const ctxMap = parseFirstParam(source);

    const results: TraitMethod[] = [];
    for (const [name, value] of Object.entries(mod)) {
      if (name === "default" || name === "methods") continue;
      if (typeof value !== "function") continue;

      const doc = tsDocMap.get(name);
      /* 检测函数是否需要 ctx：优先用 TSDoc 解析结果，否则用签名检测 */
      const needsCtx = doc?.needsCtx ?? ctxMap.get(name) ?? false;
      results.push({
        name,
        description: doc?.description ?? "",
        params: doc?.params ?? [],
        fn: value as (...args: unknown[]) => Promise<unknown>,
        needsCtx,
      });
    }
    return results;
  } catch {
    return [];
  }
}

/**
 * 从旧格式的 methods 对象加载方法
 */
function loadMethodsFromStructured(exported: Record<string, unknown>): TraitMethod[] {
  const results: TraitMethod[] = [];
  for (const [name, def] of Object.entries(exported)) {
    const d = def as Record<string, unknown>;
    if (typeof d.fn !== "function") continue;

    results.push({
      name,
      description: typeof d.description === "string" ? d.description : "",
      params: Array.isArray(d.params)
        ? d.params.map((p: Record<string, unknown>) => ({
            name: String(p.name ?? ""),
            type: String(p.type ?? "unknown"),
            description: String(p.description ?? ""),
            required: Boolean(p.required ?? false),
          }))
        : [],
      fn: d.fn as (...args: unknown[]) => Promise<unknown>,
      needsCtx: true,
    });
  }
  return results;
}

/** TSDoc 解析结果 */
interface TSDocInfo {
  description: string;
  params: TraitMethodParam[];
  needsCtx: boolean;
}

/**
 * 从源码中解析 TSDoc 注释
 *
 * 匹配模式：
 * ```
 * /** 描述文本
 *  * @param name - 参数描述
 *  *\/
 * export (async) function funcName(ctx, param1: type, param2: type) { ... }
 * ```
 *
 * @param source - TypeScript 源码
 * @returns Map<函数名, TSDocInfo>
 */
export function parseTSDoc(source: string): Map<string, TSDocInfo> {
  const result = new Map<string, TSDocInfo>();

  /* 匹配 JSDoc 注释块 + 紧跟的 export function 声明 */
  const pattern = /\/\*\*([\s\S]*?)\*\/\s*export\s+(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/g;

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    const commentBlock = match[1]!;
    const funcName = match[2]!;
    const paramList = match[3]!;

    /* 解析描述（第一行非 @param 的内容） */
    const lines = commentBlock
      .split("\n")
      .map((l) => l.replace(/^\s*\*\s?/, "").trim())
      .filter((l) => l.length > 0);

    const descLines: string[] = [];
    for (const line of lines) {
      if (line.startsWith("@")) break;
      descLines.push(line);
    }
    const description = descLines.join(" ").trim();

    /* 解析 @param 注释 */
    const paramDocs = new Map<string, string>();
    const paramPattern = /@param\s+(\w+)\s*-\s*(.*)/g;
    let paramMatch: RegExpExecArray | null;
    while ((paramMatch = paramPattern.exec(commentBlock)) !== null) {
      paramDocs.set(paramMatch[1]!, paramMatch[2]!.trim());
    }

    /* 从函数签名中解析参数 */
    const params: TraitMethodParam[] = [];
    const rawParams = paramList.split(",").map((p) => p.trim()).filter((p) => p.length > 0);

    /* 检测第一个参数是否是 ctx */
    const firstParamName = rawParams[0]?.split(":")[0]?.split("=")[0]?.trim() ?? "";
    const needsCtx = firstParamName === "ctx";
    const startIdx = needsCtx ? 1 : 0; /* 有 ctx 则跳过第一个参数 */

    for (let i = startIdx; i < rawParams.length; i++) {
      const raw = rawParams[i]!;
      /* 解析 "name: type = default" 或 "name" */
      const hasDefault = raw.includes("=");
      const withoutDefault = raw.split("=")[0]!.trim();
      const parts = withoutDefault.split(":").map((s) => s.trim());
      const paramName = parts[0]!;
      const paramType = parts[1] ?? "unknown";

      params.push({
        name: paramName,
        type: paramType,
        description: paramDocs.get(paramName) ?? "",
        required: !hasDefault,
      });
    }

    result.set(funcName, { description, params, needsCtx });
  }

  return result;
}

/**
 * 从源码中检测每个 export function 的第一个参数是否是 ctx
 *
 * 用于没有 TSDoc 注释的函数（如 LLM 创建的 trait）。
 */
function parseFirstParam(source: string): Map<string, boolean> {
  const result = new Map<string, boolean>();
  const pattern = /export\s+(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    const funcName = match[1]!;
    const paramList = match[2]!;
    const firstParam = paramList.split(",")[0]?.split(":")[0]?.split("=")[0]?.trim() ?? "";
    result.set(funcName, firstParam === "ctx");
  }
  return result;
}

/**
 * 按名称列表加载指定的 trait（用于 _traits_ref 机制）
 *
 * 只加载 refs 中列出的 trait，跳过不存在的目录。
 *
 * @param traitsDir - trait 所在的父目录（如 library/traits/）
 * @param refs - 要加载的 trait 名称列表
 * @returns 加载成功的 TraitDefinition 列表
 */
export async function loadTraitsByRef(
  traitsDir: string,
  refs: string[],
): Promise<TraitDefinition[]> {
  const results: TraitDefinition[] = [];
  for (const name of refs) {
    const traitDir = join(traitsDir, name);
    if (!existsSync(traitDir)) continue;
    const trait = await loadTrait(traitDir, name);
    if (trait) results.push(trait);
  }
  return results;
}

/**
 * 加载一个对象的所有 Traits（kernel → library → 对象自身）
 *
 * 加载优先级（同名后者覆盖前者）：
 * 1. kernel traits — 系统级基础能力
 * 2. library traits — 用户级公共能力
 * 3. object traits — 对象自定义能力
 *
 * @param objectTraitsDir - 对象的 traits/ 目录
 * @param kernelTraitsDir - kernel traits 目录
 * @param libraryTraitsDir - library traits 目录（可选）
 * @returns 合并后的 Trait 列表
 */
export async function loadAllTraits(
  objectTraitsDir: string,
  kernelTraitsDir: string,
  libraryTraitsDir?: string,
): Promise<TraitDefinition[]> {
  const traitMap = new Map<string, TraitDefinition>();

  /* 1. 加载 kernel traits */
  if (existsSync(kernelTraitsDir)) {
    const kernelNames = readdirSync(kernelTraitsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);

    for (const name of kernelNames) {
      const trait = await loadTrait(join(kernelTraitsDir, name), name);
      if (trait) traitMap.set(name, trait);
    }
  }

  /* 2. 加载 library traits（同名覆盖 kernel） */
  if (libraryTraitsDir && existsSync(libraryTraitsDir)) {
    const libraryNames = readdirSync(libraryTraitsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);

    for (const name of libraryNames) {
      const trait = await loadTrait(join(libraryTraitsDir, name), name);
      if (trait) traitMap.set(name, trait);
    }
  }

  /* 3. 加载对象 traits（同名覆盖 library 和 kernel） */
  if (existsSync(objectTraitsDir)) {
    const objectNames = readdirSync(objectTraitsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);

    for (const name of objectNames) {
      const trait = await loadTrait(join(objectTraitsDir, name), name);
      if (trait) traitMap.set(name, trait);
    }
  }

  return Array.from(traitMap.values());
}

/** 合法的 hook 事件名 */
const VALID_HOOK_EVENTS = new Set<TraitHookEvent>(["before", "after", "when_finish", "when_wait", "when_error"]);

/**
 * 从 inject 文本提取默认的 inject_title（前 50 个字符）
 */
function extractDefaultTitle(inject: string): string {
  const trimmed = inject.trim().replace(/^[\n\r]+/, "").replace(/[\n\r].*$/, "");
  return trimmed.length > 50 ? trimmed.slice(0, 50) + "..." : trimmed;
}

/**
 * 从 frontmatter 的 hooks 字段解析 Trait Hooks
 *
 * 支持两种格式：
 * 1. 简写：hooks: { when_finish: "提示文本" }
 * 2. 完整：hooks: { when_finish: { inject: "提示文本", inject_title: "标题", once: true } }
 */
function parseTraitHooks(raw: unknown): TraitDefinition["hooks"] {
  if (!raw || typeof raw !== "object") return undefined;

  const result: Partial<Record<TraitHookEvent, TraitHook>> = {};
  let hasAny = false;

  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!VALID_HOOK_EVENTS.has(key as TraitHookEvent)) continue;

    if (typeof value === "string") {
      /* 简写格式 */
      result[key as TraitHookEvent] = {
        inject: value,
        inject_title: extractDefaultTitle(value),
        once: true,
      };
      hasAny = true;
    } else if (value && typeof value === "object") {
      const obj = value as Record<string, unknown>;
      if (typeof obj.inject === "string") {
        result[key as TraitHookEvent] = {
          inject: obj.inject,
          inject_title: typeof obj.inject_title === "string" ? obj.inject_title : extractDefaultTitle(obj.inject),
          once: obj.once !== false, /* 默认 true */
        };
        hasAny = true;
      }
    }
  }

  return hasAny ? result : undefined;
}
