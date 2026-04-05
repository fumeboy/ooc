/**
 * Trait 加载器 (G3)
 *
 * 从文件系统的 traits/ 目录加载 Trait 定义。
 * 支持两种格式（优先级从高到低）：
 * 1. TRAIT.md - 新格式（推荐）
 * 2. SKILL.md - 兼容 superpowers skill 体系
 *
 * 目录结构：
 * traits/
 * └── {namespace}/             # namespace: 如 kernel, lark, web
 *     └── {name}/               # name: 如 computable, wiki
 *         ├── TRAIT.md
 *         └── index.ts (可选)
 *
 * @ref docs/哲学文档/gene.md#G3 — implements — Trait 从文件系统加载（TRAIT.md/SKILL.md + index.ts）
 * @ref docs/哲学文档/gene.md#G7 — references — Trait 目录即 Trait 存在
 * @ref src/types/trait.ts — references — TraitDefinition 类型
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import matter from "gray-matter";
import type {
  TraitDefinition,
  TraitTree,
  TraitMethod,
  TraitType,
  TraitHook,
  TraitHookEvent,
} from "../types/index.js";
import { traitId } from "./activator.js";

/**
 * 从单个 trait 目录加载 Trait 定义
 *
 * @param traitDir - trait 目录路径
 * @param traitName - trait 完整路径名（如 "kernel/computable"）
 * @param _namespace - @deprecated 已废弃，保留参数签名兼容
 * @returns TraitDefinition，若目录无效返回 null
 */
export async function loadTrait(
  traitDir: string,
  traitName?: string,
  _namespace?: string,
): Promise<TraitDefinition | null> {
  if (!existsSync(traitDir)) return null;

  // 确定 trait 名称
  let name = traitName;
  if (!name) {
    const parts = traitDir.split(/[/\\]/);
    name = parts[parts.length - 1] || "";
  }

  // 尝试读取两种格式的文件
  let content = "";
  let when: TraitDefinition["when"] = "never";
  let description = "";
  let type: TraitType = "how_to_think"; // 默认类型
  let version: string | undefined;
  let deps: string[] = [];
  let hooks: TraitDefinition["hooks"];

  const traitPath = join(traitDir, "TRAIT.md");
  const skillPath = join(traitDir, "SKILL.md");
  const legacyReadmePath = join(traitDir, "readme.md");

  // 优先级：TRAIT.md > SKILL.md > readme.md（兼容旧 library skills）
  if (existsSync(traitPath)) {
    const raw = readFileSync(traitPath, "utf-8");
    const { data, content: body } = matter(raw);
    content = body.trim();
    when = typeof data.when === "string" ? (data.when as TraitDefinition["when"]) : "never";
    description = typeof data.description === "string" ? data.description : "";
    type = parseTraitType(data.type);
    version = typeof data.version === "string" ? data.version : undefined;
    deps = Array.isArray(data.deps) ? data.deps.map(String) : [];
    hooks = parseTraitHooks(data.hooks);
    name = resolveTraitName(name, data);
  } else if (existsSync(skillPath)) {
    // SKILL.md 格式兼容
    const raw = readFileSync(skillPath, "utf-8");
    const { data, content: body } = matter(raw);
    content = body.trim();
    when = typeof data.when === "string" ? (data.when as TraitDefinition["when"]) : "never";
    description = typeof data.description === "string" ? data.description : "";
    type = parseTraitType(data.type);
    version = typeof data.version === "string" ? data.version : undefined;
    deps = Array.isArray(data.deps) ? data.deps.map(String) : [];
    hooks = parseTraitHooks(data.hooks);
    name = resolveTraitName(name, data);
  } else if (existsSync(legacyReadmePath)) {
    const raw = readFileSync(legacyReadmePath, "utf-8");
    const { data, content: body } = matter(raw);
    content = body.trim();
    when = typeof data.when === "string" ? (data.when as TraitDefinition["when"]) : "never";
    description = typeof data.description === "string" ? data.description : "";
    type = parseTraitType(data.type);
    version = typeof data.version === "string" ? data.version : undefined;
    deps = Array.isArray(data.deps) ? data.deps.map(String) : [];
    hooks = parseTraitHooks(data.hooks);
    name = resolveTraitName(name, data);
  } else {
    // 无有效文件
    return null;
  }

  /* 加载 index.ts 中的方法 */
  let methods: TraitMethod[] = [];
  const indexPath = join(traitDir, "index.ts");
  if (existsSync(indexPath)) {
    methods = await loadTraitMethods(indexPath);
  }

  return {
    name,
    type,
    version,
    when,
    description,
    readme: content,
    methods,
    deps,
    hooks,
    dir: traitDir,
  };
}

/**
 * 解析 trait 的完整路径名
 *
 * 优先级：
 * 1. frontmatter 中的 name 字段（如果包含 /，视为完整路径）
 * 2. frontmatter 中的 namespace + name 拼接（兼容旧格式）
 * 3. 调用方传入的 traitName（由 loadTraitsFromDir 根据目录结构构建）
 *
 * 旧格式兼容：
 * - namespace: lark, name: doc → lark/doc
 * - name: lark-wiki（连字符格式） → lark/wiki
 */
function resolveTraitName(callerName: string, data: Record<string, unknown>): string {
  const fmName = typeof data.name === "string" ? data.name.trim() : "";
  const fmNamespace = typeof data.namespace === "string" ? data.namespace.trim() : "";

  // 新格式：frontmatter name 已经是完整路径（包含 /）
  if (fmName && fmName.includes("/")) {
    return fmName;
  }

  // 旧格式兼容：namespace + name
  if (fmNamespace && fmName) {
    return `${fmNamespace}/${fmName}`;
  }

  // 调用方传入的名称已包含 prefix（由 loadTraitsFromDir 构建）
  if (callerName && callerName.includes("/")) {
    return callerName;
  }

  // 旧格式兼容：连字符分隔（如 lark-wiki → lark/wiki）
  if (fmName && fmName.includes("-")) {
    const [first, ...rest] = fmName.split("-");
    if (first && rest.length > 0) {
      return `${first}/${rest.join("-")}`;
    }
  }

  // fallback：使用 frontmatter name 或调用方名称
  return fmName || callerName;
}

/**
 * 解析 Trait 类型
 */
function parseTraitType(type: unknown): TraitType {
  if (type === "how_to_use_tool") return "how_to_use_tool";
  if (type === "how_to_think") return "how_to_think";
  if (type === "how_to_interact") return "how_to_interact";
  return "how_to_think"; // 默认
}

/**
 * 从 index.ts 动态加载方法
 *
 * 支持两种格式：
 *
 * 1. 旧格式（结构化导出）：
 * export const methods = {
 *   search: { description: "搜索", params: [...], fn: async (ctx, query) => { ... } }
 * };
 *
 * 2. 新格式（TSDoc 注释 + 直接导出函数）：
 * /** 搜索信息 @param query - 搜索关键词 *\/
 * export async function search(ctx, query) { ... }
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
  params: TraitMethod["params"];
  needsCtx: boolean;
}

/**
 * 从源码中解析 TSDoc 注释
 *
 * 匹配模式：
 * /** 描述文本
 *  * @param name - 参数描述
 *  *\/
 * export (async) function funcName(ctx, param1: type, param2: type) { ... }
 *
 * @param source - TypeScript 源码
 * @returns Map<函数名, TSDocInfo>
 */
export function parseTSDoc(source: string): Map<string, TSDocInfo> {
  const result = new Map<string, TSDocInfo>();

  /* 匹配 JSDoc 注释块 + 紧跟的 export function 声明 */
  const pattern =
    /\/\*\*([\s\S]*?)\*\/\s*export\s+(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/g;

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
    const params: TraitMethod["params"] = [];
    const rawParams = paramList
      .split(",")
      .map((p) => p.trim())
      .filter((p) => p.length > 0);

    /* 检测第一个参数是否是 ctx */
    const firstParamName =
      rawParams[0]?.split(":")[0]?.split("=")[0]?.trim() ?? "";
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
    const firstParam =
      paramList.split(",")[0]?.split(":")[0]?.split("=")[0]?.trim() ?? "";
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
 * @param refs - 要加载的 trait 完整路径名列表（如 "lark/doc"）
 * @returns 加载成功的 TraitDefinition 列表
 */
export async function loadTraitsByRef(
  traitsDir: string,
  refs: string[],
): Promise<TraitDefinition[]> {
  const results: TraitDefinition[] = [];
  for (const ref of refs) {
    // ref 就是完整路径，直接用 / 分割拼接目录
    const traitDir = join(traitsDir, ...ref.split("/"));

    if (!existsSync(traitDir)) continue;
    const trait = await loadTrait(traitDir, ref);
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
): Promise<{ traits: TraitDefinition[]; tree: TraitTree[] }> {
  const traitMap = new Map<string, TraitDefinition>();

  /* 1. 加载 kernel traits */
  if (existsSync(kernelTraitsDir)) {
    const kernelTraits = await loadTraitsFromDir(kernelTraitsDir, "kernel");
    for (const trait of kernelTraits) {
      traitMap.set(traitId(trait), trait);
    }
  }

  /* 2. 加载 library traits（同名覆盖 kernel） */
  if (libraryTraitsDir && existsSync(libraryTraitsDir)) {
    const libraryTraits = await loadTraitsFromDir(libraryTraitsDir, "");
    for (const trait of libraryTraits) {
      traitMap.set(traitId(trait), trait);
    }
  }

  /* 3. 加载对象 traits（同名覆盖 library 和 kernel） */
  if (existsSync(objectTraitsDir)) {
    const objectTraits = await loadTraitsFromDir(objectTraitsDir, "");
    for (const trait of objectTraits) {
      traitMap.set(traitId(trait), trait);
    }
  }

  const traits = Array.from(traitMap.values());
  const tree = buildTraitTree(traits);

  return { traits, tree };
}

/**
 * 从目录递归加载所有 traits（支持树形嵌套结构）
 *
 * 目录结构：
 * traits/
 * ├── computable/              ← trait（含 TRAIT.md）
 * │   ├── TRAIT.md             ← 父 trait（精简版）
 * │   ├── output_format/       ← 子 trait
 * │   │   └── TRAIT.md
 * │   └── program_api/
 * │       └── TRAIT.md
 * └── verifiable/
 *     └── TRAIT.md
 *
 * @param traitsDir - traits 根目录
 * @param prefix - 路径前缀（如 "kernel"），会拼接到目录名前面构成完整 name
 * @param parentPath - 父路径（用于构建多级 name），内部递归使用
 */
export async function loadTraitsFromDir(
  traitsDir: string,
  prefix: string,
  parentPath: string = "",
): Promise<TraitDefinition[]> {
  if (!existsSync(traitsDir)) return [];

  const results: TraitDefinition[] = [];
  const entries = readdirSync(traitsDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith(".")) continue;

    const entryPath = join(traitsDir, entry.name);
    const relativeName = parentPath ? `${parentPath}/${entry.name}` : entry.name;
    // 完整 trait name = prefix/relativeName（如 kernel/computable）
    const fullName = prefix ? `${prefix}/${relativeName}` : relativeName;

    // 检查此目录本身是否是 trait（含 TRAIT.md/SKILL.md/readme.md）
    const hasTraitFile =
      existsSync(join(entryPath, "TRAIT.md")) ||
      existsSync(join(entryPath, "SKILL.md")) ||
      existsSync(join(entryPath, "readme.md"));

    if (hasTraitFile) {
      // 此目录是 trait，加载它
      const trait = await loadTrait(entryPath, fullName);
      if (trait) results.push(trait);
    }

    // 无论是否自身是 trait，都检查子目录是否含 trait（递归）
    const subEntries = readdirSync(entryPath, { withFileTypes: true });
    const hasSubTraits = subEntries.some(
      (sub) =>
        sub.isDirectory() &&
        !sub.name.startsWith(".") &&
        (existsSync(join(entryPath, sub.name, "TRAIT.md")) ||
          existsSync(join(entryPath, sub.name, "SKILL.md")) ||
          existsSync(join(entryPath, sub.name, "readme.md")))
    );

    if (hasSubTraits) {
      // 递归加载子 trait
      const childTraits = await loadTraitsFromDir(
        entryPath,
        prefix,
        relativeName,
      );
      results.push(...childTraits);
    }
  }

  return results;
}

/** 合法的 hook 事件名 */
const VALID_HOOK_EVENTS = new Set<TraitHookEvent>([
  "before",
  "after",
  "when_finish",
  "when_wait",
  "when_error",
]);

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
          inject_title:
            typeof obj.inject_title === "string"
              ? obj.inject_title
              : extractDefaultTitle(obj.inject),
          once: obj.once !== false, /* 默认 true */
        };
        hasAny = true;
      }
    }
  }

  return hasAny ? result : undefined;
}

/**
 * 从扁平的 TraitDefinition 列表构建树形索引
 *
 * @param traits - 所有已加载的 trait
 * @returns 根节点列表（namespace 级别）
 */
export function buildTraitTree(traits: TraitDefinition[]): TraitTree[] {
  const nodes = new Map<string, TraitTree>();

  // 创建所有节点
  for (const trait of traits) {
    const id = traitId(trait);
    const path = trait.dir || "";
    const parts = trait.name.split("/");
    nodes.set(id, {
      id,
      path,
      trait,
      children: [],
      depth: parts.length - 1,
    });
  }

  // 建立父子关系
  const roots: TraitTree[] = [];
  for (const [id, node] of nodes) {
    const fullName = traitId(node.trait);
    const lastSlash = fullName.lastIndexOf("/");
    // 至少需要两段才有 parent（如 kernel/computable/output_format → parent = kernel/computable）
    const secondLastSlash = lastSlash > 0 ? fullName.lastIndexOf("/", lastSlash - 1) : -1;
    const parentId = secondLastSlash >= 0 ? fullName.substring(0, lastSlash) : null;

    if (parentId) {
      const parent = nodes.get(parentId);
      if (parent) {
        parent.children.push(node);
        node.trait.parent = parentId;
      } else {
        roots.push(node);
      }
    } else {
      roots.push(node);
    }
  }

  // 填充 children 字段到 TraitDefinition
  for (const [, node] of nodes) {
    if (node.children.length > 0) {
      node.trait.children = node.children.map((c) => c.id);
    }
  }

  return roots;
}
