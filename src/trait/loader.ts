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
  TraitNamespace,
  TraitKind,
} from "../types/index.js";
import { traitId } from "./activator.js";

/** 合法 namespace 集合 */
const VALID_NAMESPACES: readonly TraitNamespace[] = ["kernel", "library", "self"];

/**
 * 校验 namespace 字段合法性
 *
 * @param raw - frontmatter 读出的原始值
 * @param fileLabel - 用于报错的文件路径标签
 */
function validateNamespace(raw: unknown, fileLabel: string): TraitNamespace {
  if (typeof raw !== "string" || !raw.trim()) {
    throw new Error(
      `[trait-loader] ${fileLabel} 缺少 frontmatter \`namespace\` 字段（必须是 kernel | library | self 之一）`,
    );
  }
  const ns = raw.trim();
  if (!VALID_NAMESPACES.includes(ns as TraitNamespace)) {
    throw new Error(
      `[trait-loader] ${fileLabel} frontmatter namespace 必须是 kernel | library | self 之一，实际：${ns}`,
    );
  }
  return ns as TraitNamespace;
}

/**
 * 校验 frontmatter 的 namespace 与预期来源一致
 *
 * loader 的每个加载入口（kernel / library / stones / flows）会传入预期 namespace；
 * 若 TRAIT.md / VIEW.md 声明的 namespace 不一致，直接报错（防止放错地方）。
 */
function expectNamespace(
  actual: TraitNamespace,
  expected: TraitNamespace | null,
  fileLabel: string,
): void {
  if (expected && actual !== expected) {
    throw new Error(
      `[trait-loader] ${fileLabel} 声明的 namespace="${actual}" 与预期来源 "${expected}" 不一致`,
    );
  }
}

/**
 * 校验 name 字段合法性
 *
 * - 必填
 * - 不允许以 "namespace:" 前缀开头（冒号属于 traitId 分隔符）
 * - 不允许出现非法字符（目前只允许字母数字、下划线、短横线、斜杠）
 */
function validateName(raw: unknown, fileLabel: string): string {
  if (typeof raw !== "string" || !raw.trim()) {
    throw new Error(
      `[trait-loader] ${fileLabel} 缺少 frontmatter \`name\` 字段`,
    );
  }
  const name = raw.trim();
  if (name.includes(":")) {
    throw new Error(
      `[trait-loader] ${fileLabel} frontmatter name 不允许包含冒号（实际："${name}"）`,
    );
  }
  if (!/^[a-zA-Z0-9_\-/]+$/.test(name)) {
    throw new Error(
      `[trait-loader] ${fileLabel} frontmatter name 含非法字符（只允许字母数字/下划线/短横线/斜杠，实际："${name}"）`,
    );
  }
  return name;
}

/**
 * 从单个 trait 目录加载 Trait 定义
 *
 * 新协议（硬迁移，无兼容层）：
 * - TRAIT.md / VIEW.md frontmatter 必须显式写 `namespace: kernel | library | self`
 *   和 `name: <相对名>`。
 * - 加载器不再从物理路径推断 name/namespace。
 *
 * @param traitDir - trait 目录路径
 * @param expectedNamespace - 预期来源 namespace（loadTraitsFromDir 传入；null 表示不校验来源）
 * @returns TraitDefinition，若目录无对应描述文件返回 null
 */
export async function loadTrait(
  traitDir: string,
  expectedNamespace: TraitNamespace | null = null,
): Promise<TraitDefinition | null> {
  if (!existsSync(traitDir)) return null;

  /* 识别描述文件：TRAIT.md / SKILL.md / readme.md（优先级递减） */
  const traitPath = join(traitDir, "TRAIT.md");
  const skillPath = join(traitDir, "SKILL.md");
  const legacyReadmePath = join(traitDir, "readme.md");

  let descPath: string | null = null;
  if (existsSync(traitPath)) descPath = traitPath;
  else if (existsSync(skillPath)) descPath = skillPath;
  else if (existsSync(legacyReadmePath)) descPath = legacyReadmePath;

  if (!descPath) return null;

  const raw = readFileSync(descPath, "utf-8");
  const { data, content: body } = matter(raw);
  const fileLabel = descPath;

  /* 新协议：强制 frontmatter 显式 namespace + name */
  const namespace = validateNamespace(data.namespace, fileLabel);
  expectNamespace(namespace, expectedNamespace, fileLabel);
  const name = validateName(data.name, fileLabel);

  const kind: TraitKind = data.kind === "view" ? "view" : "trait";
  const content = body.trim();
  const when: TraitDefinition["when"] =
    typeof data.when === "string" ? (data.when as TraitDefinition["when"]) : "never";
  const description = typeof data.description === "string" ? data.description : "";
  const type: TraitType = parseTraitType(data.type);
  const version = typeof data.version === "string" ? data.version : undefined;
  const deps: string[] = Array.isArray(data.deps) ? data.deps.map(String) : [];
  const hooks = parseTraitHooks(data.hooks);
  const commandBinding = parseCommandBinding(data.command_binding);

  /* 加载 index.ts（或 backend.ts——view 用 backend.ts）的方法 */
  const indexPath = join(traitDir, "index.ts");
  const backendPath = join(traitDir, "backend.ts");
  const methodsFile = existsSync(indexPath)
    ? indexPath
    : existsSync(backendPath)
    ? backendPath
    : null;

  let llmMethods: Record<string, TraitMethod> | undefined;
  let uiMethods: Record<string, TraitMethod> | undefined;
  let legacyMethods: TraitMethod[] = [];
  if (methodsFile) {
    const loaded = await loadTraitMethods(methodsFile);
    llmMethods = loaded.llmMethods;
    uiMethods = loaded.uiMethods;
    legacyMethods = loaded.legacyMethods;
  }

  return {
    namespace,
    name,
    kind,
    type,
    version,
    when,
    description,
    readme: content,
    methods: legacyMethods, // 过渡期保留，Phase 2 收尾后可删
    llmMethods,
    uiMethods,
    deps,
    hooks,
    commandBinding,
    dir: traitDir,
  };
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

/** loadTraitMethods 的返回值：三路方法表 */
interface LoadedMethods {
  /** `export const llm_methods = { ... }` → 装入 llm channel */
  llmMethods?: Record<string, TraitMethod>;
  /** `export const ui_methods = { ... }` → 装入 ui channel */
  uiMethods?: Record<string, TraitMethod>;
  /**
   * 过渡期兼容：`export const methods = { ... }` 或直接 export function。
   *
   * Phase 2 每个 trait 迁移到 llm_methods 后逐步消失；最终收尾删除。
   */
  legacyMethods: TraitMethod[];
}

/**
 * 从 index.ts / backend.ts 动态加载方法
 *
 * 新协议（Phase 2）：优先读 `export const llm_methods` / `export const ui_methods`
 * 双命名映射（Record<name, TraitMethodDef>）。
 *
 * 过渡期兼容：
 * - `export const methods = {...}` → legacyMethods（装入 llm channel）
 * - `export async function name(...)` 直接函数导出 → 同上
 *
 * @param indexPath - index.ts 或 backend.ts 的绝对路径
 */
async function loadTraitMethods(indexPath: string): Promise<LoadedMethods> {
  try {
    const mod = await import(`${indexPath}?t=${Date.now()}`);

    const llmMethods = parseNamedMethodsRecord(mod.llm_methods);
    const uiMethods = parseNamedMethodsRecord(mod.ui_methods);

    /* 过渡期：兼容旧 export const methods = {...} 对象 */
    let legacyMethods: TraitMethod[] = [];
    const legacyExport = mod.methods as Record<string, unknown> | undefined;
    if (legacyExport && typeof legacyExport === "object") {
      legacyMethods = loadMethodsFromStructured(legacyExport);
    } else if (!llmMethods && !uiMethods) {
      /* 无新旧任何已命名导出时，走 TSDoc 自动解析路径（library/sessions/index 等遗留） */
      const source = readFileSync(indexPath, "utf-8");
      const tsDocMap = parseTSDoc(source);
      const ctxMap = parseFirstParam(source);

      for (const [name, value] of Object.entries(mod)) {
        if (name === "default" || name === "methods" || name === "llm_methods" || name === "ui_methods") continue;
        if (typeof value !== "function") continue;

        const doc = tsDocMap.get(name);
        const needsCtx = doc?.needsCtx ?? ctxMap.get(name) ?? false;
        legacyMethods.push({
          name,
          description: doc?.description ?? "",
          params: doc?.params ?? [],
          fn: value as (...args: unknown[]) => Promise<unknown>,
          needsCtx,
        });
      }
    }

    return { llmMethods, uiMethods, legacyMethods };
  } catch {
    return { legacyMethods: [] };
  }
}

/**
 * 解析 `Record<name, TraitMethodDef>` 导出 → `Record<name, TraitMethod>`
 *
 * Phase 2 推荐的导出形态：
 * ```ts
 * export const llm_methods = {
 *   readFile: {
 *     description: "...",
 *     params: [{ name: "path", type: "string", description: "...", required: true }],
 *     fn: async (ctx, { path }) => { ... },
 *   },
 * };
 * ```
 */
function parseNamedMethodsRecord(raw: unknown): Record<string, TraitMethod> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const result: Record<string, TraitMethod> = {};
  for (const [name, def] of Object.entries(raw as Record<string, unknown>)) {
    const d = def as Record<string, unknown> | null;
    if (!d || typeof d !== "object") continue;
    if (typeof d.fn !== "function") continue;
    result[name] = {
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
      needsCtx: d.needsCtx !== false, /* 默认 true */
    };
  }
  return result;
}

/**
 * 从旧格式的 methods 对象加载方法（过渡期）
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
      /* 解析 "name: type = default" 或 "name" 或 "name?: type" */
      const hasDefault = raw.includes("=");
      const withoutDefault = raw.split("=")[0]!.trim();
      const parts = withoutDefault.split(":").map((s) => s.trim());
      let paramName = parts[0]!;
      /* 去掉可选参数的 ? 后缀（如 description? → description） */
      const isOptional = paramName.endsWith("?");
      if (isOptional) paramName = paramName.slice(0, -1);
      const paramType = parts[1] ?? "unknown";

      params.push({
        name: paramName,
        type: paramType,
        description: paramDocs.get(paramName) ?? "",
        required: !hasDefault && !isOptional,
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
 * @param refs - 要加载的 trait 相对名列表（如 "lark/doc"）
 * @param expectedNamespace - 预期 namespace（用于 frontmatter 校验）
 * @returns 加载成功的 TraitDefinition 列表
 */
export async function loadTraitsByRef(
  traitsDir: string,
  refs: string[],
  expectedNamespace: TraitNamespace | null = null,
): Promise<TraitDefinition[]> {
  const results: TraitDefinition[] = [];
  for (const ref of refs) {
    // ref 是 namespace 下的相对名，用 / 分割拼接目录
    const traitDir = join(traitsDir, ...ref.split("/"));

    if (!existsSync(traitDir)) continue;
    const trait = await loadTrait(traitDir, expectedNamespace);
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
 * 3. object traits — 对象自定义能力（self namespace）
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
    const libraryTraits = await loadTraitsFromDir(libraryTraitsDir, "library");
    for (const trait of libraryTraits) {
      traitMap.set(traitId(trait), trait);
    }
  }

  /* 3. 加载对象 traits（self namespace，同名覆盖 library 和 kernel） */
  if (existsSync(objectTraitsDir)) {
    const objectTraits = await loadTraitsFromDir(objectTraitsDir, "self");
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
 * @param expectedNamespace - 预期 namespace（kernel / library / self）
 *   loader 会校验 TRAIT.md frontmatter 的 namespace 与之一致。
 */
export async function loadTraitsFromDir(
  traitsDir: string,
  expectedNamespace: TraitNamespace,
): Promise<TraitDefinition[]> {
  if (!existsSync(traitsDir)) return [];

  const results: TraitDefinition[] = [];

  /** 递归扫描 */
  const visit = async (dir: string): Promise<void> => {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      if (entry.name.startsWith(".")) continue;

      const entryPath = join(dir, entry.name);

      // 支持 symlink：只有指向目录的 symlink 才视为可递归的 trait 目录
      if (entry.isSymbolicLink()) {
        try {
          if (!statSync(entryPath).isDirectory()) continue;
        } catch {
          continue;
        }
      }

      // 检查此目录本身是否是 trait（含 TRAIT.md/SKILL.md/readme.md）
      const hasTraitFile =
        existsSync(join(entryPath, "TRAIT.md")) ||
        existsSync(join(entryPath, "SKILL.md")) ||
        existsSync(join(entryPath, "readme.md"));

      if (hasTraitFile) {
        const trait = await loadTrait(entryPath, expectedNamespace);
        if (trait) results.push(trait);
      }

      // 递归扫描子目录（无论本层是否是 trait，子目录都可能有 trait）
      await visit(entryPath);
    }
  };

  await visit(traitsDir);
  return results;
}

/**
 * 解析 command_binding frontmatter 字段
 */
function parseCommandBinding(raw: unknown): TraitDefinition["commandBinding"] {
  if (!raw || typeof raw !== "object") return undefined;
  const cb = raw as Record<string, unknown>;
  if (Array.isArray(cb.commands)) {
    return { commands: cb.commands.map(String) };
  }
  return undefined;
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
 * 新协议下 traitId = `namespace:name`，父子关系按**同 namespace 内 name 的 `/` 分级**推断。
 *
 * 例：
 *   kernel:computable         ← 根（name 无 `/`）
 *   kernel:computable/file_ops ← 子（parent = kernel:computable）
 *
 * @param traits - 所有已加载的 trait
 * @returns 根节点列表（每个 namespace 下独立成树）
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
    const name = node.trait.name;
    const lastSlash = name.lastIndexOf("/");
    const parentName = lastSlash > 0 ? name.substring(0, lastSlash) : null;
    const parentId = parentName ? `${node.trait.namespace}:${parentName}` : null;

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
