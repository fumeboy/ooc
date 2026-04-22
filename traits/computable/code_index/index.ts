/**
 * code_index —— 代码语义索引 kernel trait（MVP）
 *
 * 基于正则的轻量 TS/JS 符号索引，提供：
 * - symbol_lookup：按名精确查找定义
 * - find_references：查找符号引用
 * - list_symbols：枚举文件/目录内符号
 * - call_hierarchy：调用链分析（callers / callees）
 * - semantic_search：语义搜索（MVP 退化为 token 匹配 + 排序）
 * - index_refresh：触发/重建索引
 *
 * 设计原则：
 * - 索引按 rootDir 维度缓存在内存，首次调用触发构建
 * - 索引数据结构是 immutable snapshot，查询返回副本
 * - 只支持 TS/JS/TSX/JSX；其他语言留给后续扩展
 */

import { resolve, relative, extname, join } from "path";
import { toolOk, toolErr } from "../../../src/types/tool-result";
import type { ToolResult } from "../../../src/types/tool-result";
import type { TraitMethod } from "../../../src/types/index";

/** 支持的语言扩展名 */
const SUPPORTED_EXTS = [".ts", ".tsx", ".js", ".jsx"] as const;
type Lang = "ts" | "tsx" | "js" | "jsx";
type SymbolKind = "function" | "class" | "interface" | "type" | "const";

/** 单个符号记录 */
export interface SymbolEntry {
  /** 相对 rootDir 的路径 */
  file: string;
  /** 1-based 行号 */
  line: number;
  /** 符号类型 */
  kind: SymbolKind;
  /** 符号名 */
  name: string;
  /** 语言 */
  lang: Lang;
}

/** 引用记录 */
export interface ReferenceEntry {
  file: string;
  line: number;
  content: string;
}

/** 索引快照（immutable） */
interface IndexSnapshot {
  /** 构建时间（ms） */
  builtAt: number;
  /** 索引根目录 */
  rootDir: string;
  /** 所有符号（按 name 聚合的索引） */
  byName: Map<string, readonly SymbolEntry[]>;
  /** 所有符号（按 file 聚合） */
  byFile: Map<string, readonly SymbolEntry[]>;
  /** 扫描的文件数量 */
  fileCount: number;
}

/** 默认忽略的目录 */
const DEFAULT_IGNORE = [
  "node_modules",
  ".git",
  ".存档",
  "dist",
  "build",
  ".next",
  ".turbo",
  "coverage",
  ".ooc",
];

/** rootDir → snapshot */
const cache = new Map<string, IndexSnapshot>();

/** 获取文件的 lang（不支持时返回 null） */
function langOf(path: string): Lang | null {
  const ext = extname(path).toLowerCase();
  if (ext === ".ts") return "ts";
  if (ext === ".tsx") return "tsx";
  if (ext === ".js") return "js";
  if (ext === ".jsx") return "jsx";
  return null;
}

/**
 * 正则匹配规则集合
 *
 * 说明：MVP 版本，覆盖常见声明形态。
 * 未来可替换为 tree-sitter 获得更高精度。
 */
const SYMBOL_PATTERNS: Array<{ kind: SymbolKind; re: RegExp }> = [
  // export function foo() / function foo() / async function foo()
  { kind: "function", re: /^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/ },
  // export const foo = (...) => / const foo = async (...) => / export const foo = function
  {
    kind: "function",
    re: /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::\s*[^=]+)?=\s*(?:async\s*)?(?:\([^)]*\)\s*(?::\s*[^=]+)?=>|function)/,
  },
  // export class Foo / class Foo
  { kind: "class", re: /^\s*(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/ },
  // export interface Foo / interface Foo
  { kind: "interface", re: /^\s*(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/ },
  // export type Foo = / type Foo =
  { kind: "type", re: /^\s*(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*[=<]/ },
  // export const FOO = / const FOO: T = （排除已被 function 规则匹配的）
  {
    kind: "const",
    re: /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::\s*[^=]+)?=\s*(?!(?:async\s*)?(?:\([^)]*\)\s*(?::\s*[^=]+)?=>|function))/,
  },
];

/** 从单行提取符号（可能返回多个，例如一行同时匹配 const + function） */
function extractSymbolsFromLine(line: string): Array<{ kind: SymbolKind; name: string }> {
  const results: Array<{ kind: SymbolKind; name: string }> = [];
  const seen = new Set<string>();
  for (const { kind, re } of SYMBOL_PATTERNS) {
    const m = line.match(re);
    if (m && m[1]) {
      const key = `${kind}:${m[1]}`;
      if (!seen.has(key)) {
        results.push({ kind, name: m[1] });
        seen.add(key);
      }
    }
  }
  return results;
}

/** 扫描单个文件，返回符号数组 */
async function scanFile(absPath: string, relPath: string): Promise<SymbolEntry[]> {
  const lang = langOf(absPath);
  if (!lang) return [];

  try {
    const text = await Bun.file(absPath).text();
    const lines = text.split("\n");
    const symbols: SymbolEntry[] = [];
    for (let i = 0; i < lines.length; i++) {
      const found = extractSymbolsFromLine(lines[i]!);
      for (const { kind, name } of found) {
        symbols.push({ file: relPath, line: i + 1, kind, name, lang });
      }
    }
    return symbols;
  } catch {
    return [];
  }
}

/** 构建索引：遍历 rootDir 下所有支持文件 */
async function buildIndex(rootDir: string): Promise<IndexSnapshot> {
  const g = new Bun.Glob("**/*.{ts,tsx,js,jsx}");
  const byName = new Map<string, SymbolEntry[]>();
  const byFile = new Map<string, SymbolEntry[]>();
  let fileCount = 0;

  for await (const rel of g.scan({ cwd: rootDir })) {
    const shouldIgnore = DEFAULT_IGNORE.some(
      (d) => rel.startsWith(d + "/") || rel.includes("/" + d + "/"),
    );
    if (shouldIgnore) continue;

    const abs = join(rootDir, rel);
    const syms = await scanFile(abs, rel);
    if (syms.length === 0) continue;

    fileCount++;
    byFile.set(rel, syms);
    for (const s of syms) {
      const arr = byName.get(s.name) ?? [];
      arr.push(s);
      byName.set(s.name, arr);
    }
  }

  // 冻结为 readonly
  const frozenByName = new Map<string, readonly SymbolEntry[]>();
  for (const [k, v] of byName.entries()) frozenByName.set(k, Object.freeze([...v]));
  const frozenByFile = new Map<string, readonly SymbolEntry[]>();
  for (const [k, v] of byFile.entries()) frozenByFile.set(k, Object.freeze([...v]));

  return {
    builtAt: Date.now(),
    rootDir,
    byName: frozenByName,
    byFile: frozenByFile,
    fileCount,
  };
}

/** 获取当前 rootDir 的 snapshot；必要时构建 */
async function getSnapshot(rootDir: string): Promise<IndexSnapshot> {
  const cached = cache.get(rootDir);
  if (cached) return cached;
  const snap = await buildIndex(rootDir);
  cache.set(rootDir, snap);
  return snap;
}

/* ========== llm_methods 实现 ========== */

async function symbolLookupImpl(
  ctx: { rootDir?: string },
  {
    query,
    kind,
    lang,
  }: { query: string; kind?: SymbolKind; lang?: Lang },
): Promise<ToolResult<SymbolEntry[]>> {
  const rootDir = ctx.rootDir ?? "";
  if (!rootDir) return toolErr("rootDir 未设置");
  if (!query || typeof query !== "string") return toolErr("query 必填");

  try {
    const snap = await getSnapshot(rootDir);
    const hits = snap.byName.get(query) ?? [];
    const filtered = hits.filter(
      (s) => (!kind || s.kind === kind) && (!lang || s.lang === lang),
    );
    return toolOk([...filtered]);
  } catch (err: any) {
    return toolErr(`symbol_lookup 失败: ${err?.message ?? String(err)}`);
  }
}

async function findReferencesImpl(
  ctx: { rootDir?: string },
  { symbol, lang, maxResults = 100 }: { symbol: string; lang?: Lang; maxResults?: number },
): Promise<ToolResult<ReferenceEntry[]>> {
  const rootDir = ctx.rootDir ?? "";
  if (!rootDir) return toolErr("rootDir 未设置");
  if (!symbol || typeof symbol !== "string") return toolErr("symbol 必填");

  try {
    // 先确保索引存在（复用已扫描文件列表，避免重复 glob）
    const snap = await getSnapshot(rootDir);
    const refs: ReferenceEntry[] = [];
    // 用单词边界正则查 symbol
    const re = new RegExp(`\\b${symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);

    for (const [relPath] of snap.byFile.entries()) {
      if (lang && langOf(relPath) !== lang) continue;
      try {
        const abs = join(rootDir, relPath);
        const text = await Bun.file(abs).text();
        const lines = text.split("\n");
        for (let i = 0; i < lines.length; i++) {
          if (re.test(lines[i]!)) {
            refs.push({ file: relPath, line: i + 1, content: lines[i]!.trim() });
            if (refs.length >= maxResults) return toolOk(refs);
          }
        }
      } catch {
        // 跳过读不到的文件
      }
    }
    return toolOk(refs);
  } catch (err: any) {
    return toolErr(`find_references 失败: ${err?.message ?? String(err)}`);
  }
}

async function listSymbolsImpl(
  ctx: { rootDir?: string },
  { path, kinds }: { path: string; kinds?: SymbolKind[] },
): Promise<ToolResult<SymbolEntry[]>> {
  const rootDir = ctx.rootDir ?? "";
  if (!rootDir) return toolErr("rootDir 未设置");
  if (!path || typeof path !== "string") return toolErr("path 必填");

  try {
    const snap = await getSnapshot(rootDir);
    const target = path.startsWith("/") ? relative(rootDir, path) : path;
    const collected: SymbolEntry[] = [];
    for (const [relPath, syms] of snap.byFile.entries()) {
      if (relPath === target || relPath.startsWith(target.endsWith("/") ? target : target + "/")) {
        for (const s of syms) {
          if (!kinds || kinds.includes(s.kind)) collected.push(s);
        }
      }
    }
    return toolOk(collected);
  } catch (err: any) {
    return toolErr(`list_symbols 失败: ${err?.message ?? String(err)}`);
  }
}

async function callHierarchyImpl(
  ctx: { rootDir?: string },
  {
    symbol,
    direction = "callers",
  }: { symbol: string; direction?: "callers" | "callees" },
): Promise<ToolResult<ReferenceEntry[]>> {
  // MVP：callers 等价于 find_references 过滤掉定义行；callees 暂不支持
  if (direction === "callees") {
    return toolErr("call_hierarchy callees 方向尚未实现（MVP 只支持 callers）");
  }
  const rootDir = ctx.rootDir ?? "";
  if (!rootDir) return toolErr("rootDir 未设置");

  const refsRes = await findReferencesImpl(ctx, { symbol });
  if (!refsRes.ok) return refsRes;

  // 过滤掉"定义行"
  const snap = await getSnapshot(rootDir);
  const defLines = new Set<string>();
  for (const s of snap.byName.get(symbol) ?? []) {
    defLines.add(`${s.file}:${s.line}`);
  }
  const callers = refsRes.data.filter((r) => !defLines.has(`${r.file}:${r.line}`));
  return toolOk(callers);
}

async function semanticSearchImpl(
  ctx: { rootDir?: string },
  { query, topK = 10 }: { query: string; topK?: number },
): Promise<ToolResult<Array<SymbolEntry & { score: number }>>> {
  // MVP：简易相似度 = query 中 token 在 symbol name 出现次数 + 子串加权
  const rootDir = ctx.rootDir ?? "";
  if (!rootDir) return toolErr("rootDir 未设置");
  if (!query || typeof query !== "string") return toolErr("query 必填");

  try {
    const snap = await getSnapshot(rootDir);
    const tokens = query
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 0);
    const scored: Array<SymbolEntry & { score: number }> = [];

    for (const [name, entries] of snap.byName.entries()) {
      const lname = name.toLowerCase();
      let score = 0;
      for (const t of tokens) {
        if (lname === t) score += 5;
        else if (lname.includes(t)) score += 2;
      }
      if (score === 0) continue;
      for (const e of entries) scored.push({ ...e, score });
    }

    scored.sort((a, b) => b.score - a.score);
    return toolOk(scored.slice(0, topK));
  } catch (err: any) {
    return toolErr(`semantic_search 失败: ${err?.message ?? String(err)}`);
  }
}

async function indexRefreshImpl(
  ctx: { rootDir?: string },
  _args: { paths?: string[] } = {},
): Promise<ToolResult<{ fileCount: number; symbolCount: number; builtAt: number }>> {
  const rootDir = ctx.rootDir ?? "";
  if (!rootDir) return toolErr("rootDir 未设置");

  try {
    // MVP：整库重建（增量可留给后续）
    cache.delete(rootDir);
    const snap = await buildIndex(rootDir);
    cache.set(rootDir, snap);
    let symbolCount = 0;
    for (const arr of snap.byFile.values()) symbolCount += arr.length;
    return toolOk({ fileCount: snap.fileCount, symbolCount, builtAt: snap.builtAt });
  } catch (err: any) {
    return toolErr(`index_refresh 失败: ${err?.message ?? String(err)}`);
  }
}

/* ========== 兼容导出（位置参数，供测试直接调用） ========== */

export const symbol_lookup = (ctx: any, query: string, opts?: { kind?: SymbolKind; lang?: Lang }) =>
  symbolLookupImpl(ctx, { query, kind: opts?.kind, lang: opts?.lang });

export const find_references = (ctx: any, symbol: string, opts?: { lang?: Lang; maxResults?: number }) =>
  findReferencesImpl(ctx, { symbol, lang: opts?.lang, maxResults: opts?.maxResults });

export const list_symbols = (ctx: any, path: string, opts?: { kinds?: SymbolKind[] }) =>
  listSymbolsImpl(ctx, { path, kinds: opts?.kinds });

export const call_hierarchy = (ctx: any, symbol: string, direction: "callers" | "callees" = "callers") =>
  callHierarchyImpl(ctx, { symbol, direction });

export const semantic_search = (ctx: any, query: string, topK = 10) =>
  semanticSearchImpl(ctx, { query, topK });

export const index_refresh = (ctx: any, paths?: string[]) => indexRefreshImpl(ctx, { paths });

/** 测试工具：清空缓存 */
export const __resetCache = () => cache.clear();

/* ========== llm_methods 导出 ========== */

export const llm_methods: Record<string, TraitMethod> = {
  symbol_lookup: {
    name: "symbol_lookup",
    description: "按名精确查找代码符号的定义位置",
    params: [
      { name: "query", type: "string", description: "符号名", required: true },
      { name: "kind", type: "string", description: "function|class|interface|type|const", required: false },
      { name: "lang", type: "string", description: "ts|tsx|js|jsx", required: false },
    ],
    fn: symbolLookupImpl as TraitMethod["fn"],
  },
  find_references: {
    name: "find_references",
    description: "查找符号的所有引用（单词边界匹配）",
    params: [
      { name: "symbol", type: "string", description: "符号名", required: true },
      { name: "lang", type: "string", description: "语言过滤", required: false },
      { name: "maxResults", type: "number", description: "最大结果数（默认 100）", required: false },
    ],
    fn: findReferencesImpl as TraitMethod["fn"],
  },
  list_symbols: {
    name: "list_symbols",
    description: "列出文件/目录内的所有符号",
    params: [
      { name: "path", type: "string", description: "文件或目录路径", required: true },
      { name: "kinds", type: "string[]", description: "符号类型过滤", required: false },
    ],
    fn: listSymbolsImpl as TraitMethod["fn"],
  },
  call_hierarchy: {
    name: "call_hierarchy",
    description: "调用链分析（MVP 只支持 callers 方向）",
    params: [
      { name: "symbol", type: "string", description: "符号名", required: true },
      { name: "direction", type: "string", description: "callers|callees", required: false },
    ],
    fn: callHierarchyImpl as TraitMethod["fn"],
  },
  semantic_search: {
    name: "semantic_search",
    description: "语义搜索（MVP 版 token 相似度）",
    params: [
      { name: "query", type: "string", description: "查询文本", required: true },
      { name: "topK", type: "number", description: "返回数量（默认 10）", required: false },
    ],
    fn: semanticSearchImpl as TraitMethod["fn"],
  },
  index_refresh: {
    name: "index_refresh",
    description: "重建代码索引",
    params: [
      { name: "paths", type: "string[]", description: "可选增量路径（MVP 忽略，整库重建）", required: false },
    ],
    fn: indexRefreshImpl as TraitMethod["fn"],
  },
};

export const ui_methods: Record<string, TraitMethod> = {};
