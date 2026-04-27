/**
 * code_index —— 代码语义索引 kernel trait
 *
 * v2：tree-sitter AST + 增量索引 + 真向量 semantic_search + callees call graph
 * （v1 正则 + 全量重建 + token 匹配 + 单向 callers 作为 fallback 保留）
 *
 * 提供的 llm_methods：
 *   - symbol_lookup   按名精确查找定义
 *   - find_references 查找符号引用
 *   - list_symbols    枚举文件/目录内符号
 *   - call_hierarchy  调用链（callers + callees）
 *   - semantic_search 向量语义搜索（cosine sim）
 *   - index_refresh   全量 / 增量重建索引
 *
 * 设计：
 *   - 索引按 rootDir 维度缓存；首次调用触发构建
 *   - tree-sitter 可用时走 AST，否则回退正则（MVP 行为保留）
 *   - 向量落盘 `.ooc/code-index/vectors.json`（首次构建写入；增量更新对应条目）
 *   - call graph 方向：byName 可反查 callers；callGraphOut 存每个定义的 callees
 *
 * @ref docs/工程管理/迭代/all/20260422_feature_code_index_v2.md
 */

import { resolve, relative, extname, join, dirname } from "path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { toolOk, toolErr } from "../../../src/types/tool-result";
import type { ToolResult } from "../../../src/types/tool-result";
import type { TraitMethod } from "../../../src/types/index";
import { parseAndExtract, tsLangOf } from "./parser/extractor";
import type { ExtractedSymbolKind } from "./parser/extractor";
import { generateEmbedding, cosineSimilarity } from "../../../src/storable/memory/embedding";

/** 支持的语言扩展名（含 v2 新增的 py/go/rs） */
const SUPPORTED_EXTS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".go", ".rs"] as const;

/** 与 v1 对齐的 Lang；保留向后兼容字面量 */
type Lang = "ts" | "tsx" | "js" | "jsx" | "py" | "go" | "rs";
type SymbolKind = ExtractedSymbolKind; /* function | class | interface | type | const */

/** 单个符号记录 */
export interface SymbolEntry {
  /** 相对 rootDir 的路径 */
  file: string;
  /** 1-based 起始行号 */
  line: number;
  /** 1-based 结束行号（v2 新增；v1 时 fallback 等于 line） */
  endLine?: number;
  /** 符号类型 */
  kind: SymbolKind;
  /** 符号名 */
  name: string;
  /** 语言 */
  lang: Lang;
  /** 签名首行（v2 新增；正则 fallback 时为空串） */
  signature?: string;
  /** docstring（v2 新增；正则 fallback 时为空串） */
  docstring?: string;
}

/** 引用记录 */
export interface ReferenceEntry {
  file: string;
  line: number;
  content: string;
}

/** 内部结构：一个符号的定义 key（文件相对 + name + line） */
type DefKey = string; /* `${file}::${name}@${line}` */

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
  /**
   * call graph：DefKey → 它调用的符号名列表（去重）
   * DefKey 统一采用 `${relFile}::${name}@${line}`
   */
  callGraphOut: Map<DefKey, readonly string[]>;
  /** 每个符号的 embedding（按 DefKey 索引） */
  vectors: Map<DefKey, readonly number[]>;
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
  if (ext === ".js" || ext === ".mjs" || ext === ".cjs") return "js";
  if (ext === ".jsx") return "jsx";
  if (ext === ".py") return "py";
  if (ext === ".go") return "go";
  if (ext === ".rs") return "rs";
  return null;
}

/**
 * v1 正则匹配规则（fallback 用；tree-sitter 不可用时生效）
 *
 * 只覆盖 TS/JS 家族——其他语言没有正则 fallback 时直接返回空数组。
 */
const SYMBOL_PATTERNS: Array<{ kind: SymbolKind; re: RegExp }> = [
  { kind: "function", re: /^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/ },
  {
    kind: "function",
    re: /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::\s*[^=]+)?=\s*(?:async\s*)?(?:\([^)]*\)\s*(?::\s*[^=]+)?=>|function)/,
  },
  { kind: "class", re: /^\s*(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/ },
  { kind: "interface", re: /^\s*(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/ },
  { kind: "type", re: /^\s*(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*[=<]/ },
  {
    kind: "const",
    re: /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::\s*[^=]+)?=\s*(?!(?:async\s*)?(?:\([^)]*\)\s*(?::\s*[^=]+)?=>|function))/,
  },
];

/** 从单行提取符号（正则 fallback） */
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

/**
 * 扫描单个文件
 *
 * 返回 `{ symbols, calleesMap }`：
 *   - symbols：符号数组（file 字段已填；行号 1-based）
 *   - calleesMap：DefKey → callees 名称列表（仅 AST 路径有；正则 fallback 为空）
 */
async function scanFile(
  absPath: string,
  relPath: string,
): Promise<{ symbols: SymbolEntry[]; calleesMap: Map<DefKey, string[]> }> {
  const lang = langOf(absPath);
  if (!lang) return { symbols: [], calleesMap: new Map() };

  let text: string;
  try {
    text = await Bun.file(absPath).text();
  } catch {
    return { symbols: [], calleesMap: new Map() };
  }

  /* 优先走 tree-sitter AST；失败回退正则（仅 TS/JS 家族） */
  const tsLang = tsLangOf(extname(absPath));
  if (tsLang) {
    try {
      const { symbols: extracted, callees } = await parseAndExtract(text, tsLang);
      const calleesMap = new Map<DefKey, string[]>();
      const symbols: SymbolEntry[] = extracted.map((s) => ({
        file: relPath,
        line: s.line,
        endLine: s.endLine,
        kind: s.kind,
        name: s.name,
        lang,
        signature: s.signature,
        docstring: s.docstring,
      }));
      for (const c of callees) {
        /* extractor 给的 symbolKey 是 `name@line`；这里补上 file 前缀 */
        const defKey: DefKey = `${relPath}::${c.symbolKey}`;
        calleesMap.set(defKey, [...c.callees]);
      }
      return { symbols, calleesMap };
    } catch {
      /* AST 失败 → 回退正则（仅当是 TS/JS 家族） */
    }
  }

  /* 正则 fallback：仅对 TS/JS 家族有意义 */
  if (!["ts", "tsx", "js", "jsx"].includes(lang)) {
    return { symbols: [], calleesMap: new Map() };
  }
  const lines = text.split("\n");
  const symbols: SymbolEntry[] = [];
  for (let i = 0; i < lines.length; i++) {
    const found = extractSymbolsFromLine(lines[i]!);
    for (const { kind, name } of found) {
      symbols.push({ file: relPath, line: i + 1, kind, name, lang, signature: "", docstring: "" });
    }
  }
  return { symbols, calleesMap: new Map() };
}

/** 某相对路径是否在忽略名单 */
function isIgnored(rel: string): boolean {
  return DEFAULT_IGNORE.some((d) => rel.startsWith(d + "/") || rel.includes("/" + d + "/"));
}

/** 构建 DefKey（给内部 callees/vectors 索引用） */
function defKeyOf(file: string, name: string, line: number): DefKey {
  return `${file}::${name}@${line}`;
}

/** 向量落盘路径（相对 rootDir） */
function vectorsPath(rootDir: string): string {
  return join(rootDir, ".ooc", "code-index", "vectors.json");
}

/** 向量盘存的 JSON schema */
interface VectorsFile {
  dim: number;
  /** 每个 DefKey → vec 数组 */
  entries: Record<string, number[]>;
  /** 用于兜底：builtAt */
  builtAt: number;
}

/** 计算一个符号的 embedding input 文本：name + signature + docstring */
function embeddingInputOf(s: SymbolEntry): string {
  const parts = [s.name];
  if (s.signature) parts.push(s.signature);
  if (s.docstring) parts.push(s.docstring);
  return parts.join(" ");
}

/**
 * 全量构建索引（rootDir 下所有支持语言的文件）
 */
async function buildIndex(rootDir: string): Promise<IndexSnapshot> {
  const pattern = `**/*{${SUPPORTED_EXTS.join(",")}}`;
  const g = new Bun.Glob(pattern);
  const byName = new Map<string, SymbolEntry[]>();
  const byFile = new Map<string, SymbolEntry[]>();
  const callGraphOut = new Map<DefKey, string[]>();
  const vectors = new Map<DefKey, number[]>();
  let fileCount = 0;

  /* glob scan 本身遇到奇怪文件名/权限问题也可能抛；整个循环外层兜底 */
  const iter = (async function*() {
    try {
      for await (const rel of g.scan({ cwd: rootDir })) yield rel;
    } catch {
      /* 提前结束 */
    }
  })();

  for await (const rel of iter) {
    if (isIgnored(rel)) continue;
    const abs = join(rootDir, rel);
    /* 任一文件报错（权限/特殊路径）都不应阻塞全量构建 */
    let scanResult: { symbols: SymbolEntry[]; calleesMap: Map<DefKey, string[]> };
    try {
      scanResult = await scanFile(abs, rel);
    } catch {
      continue;
    }
    const { symbols, calleesMap } = scanResult;
    if (symbols.length === 0) continue;

    fileCount++;
    byFile.set(rel, symbols);
    for (const s of symbols) {
      const arr = byName.get(s.name) ?? [];
      arr.push(s);
      byName.set(s.name, arr);
      /* embedding：name + signature + docstring */
      const vec = generateEmbedding(embeddingInputOf(s));
      vectors.set(defKeyOf(s.file, s.name, s.line), vec);
    }
    for (const [k, v] of calleesMap.entries()) callGraphOut.set(k, v);
  }

  return freezeSnapshot(rootDir, byName, byFile, callGraphOut, vectors, fileCount);
}

/**
 * 把内部 Map 冻结为 readonly snapshot
 */
function freezeSnapshot(
  rootDir: string,
  byName: Map<string, SymbolEntry[]>,
  byFile: Map<string, SymbolEntry[]>,
  callGraphOut: Map<DefKey, string[]>,
  vectors: Map<DefKey, number[]>,
  fileCount: number,
): IndexSnapshot {
  const frozenByName = new Map<string, readonly SymbolEntry[]>();
  for (const [k, v] of byName.entries()) frozenByName.set(k, Object.freeze([...v]));
  const frozenByFile = new Map<string, readonly SymbolEntry[]>();
  for (const [k, v] of byFile.entries()) frozenByFile.set(k, Object.freeze([...v]));
  const frozenCg = new Map<DefKey, readonly string[]>();
  for (const [k, v] of callGraphOut.entries()) frozenCg.set(k, Object.freeze([...v]));
  const frozenVec = new Map<DefKey, readonly number[]>();
  for (const [k, v] of vectors.entries()) frozenVec.set(k, Object.freeze([...v]));
  return {
    builtAt: Date.now(),
    rootDir,
    byName: frozenByName,
    byFile: frozenByFile,
    fileCount,
    callGraphOut: frozenCg,
    vectors: frozenVec,
  };
}

/**
 * 落盘向量到 `.ooc/code-index/vectors.json`
 *
 * 失败不抛（只记 console.warn）——盘存是缓存，构建仍在内存中可用。
 */
function persistVectors(snap: IndexSnapshot): void {
  try {
    const p = vectorsPath(snap.rootDir);
    const dir = dirname(p);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const entries: Record<string, number[]> = {};
    for (const [k, v] of snap.vectors.entries()) entries[k] = [...v];
    const file: VectorsFile = { dim: 256, entries, builtAt: snap.builtAt };
    writeFileSync(p, JSON.stringify(file), "utf-8");
  } catch (err: any) {
    /* 持久化失败只做静默告警；不影响运行时 */
    console.warn(`[code_index] 向量持久化失败: ${err?.message ?? err}`);
  }
}

/**
 * 增量更新：对一组相对路径重扫并合并进现有 snapshot
 *
 * - 对每个 path：先从 byFile/byName/callGraphOut/vectors 里清掉旧条目
 * - 若文件仍然存在（能读到）：用新扫描结果替换
 * - 若文件不存在（删除）：只做清理
 */
async function applyIncremental(
  snap: IndexSnapshot,
  relPaths: string[],
): Promise<IndexSnapshot> {
  /* 先做 mutable 副本——局部构建完成后再 freeze */
  const byName = new Map<string, SymbolEntry[]>();
  for (const [k, v] of snap.byName.entries()) byName.set(k, [...v]);
  const byFile = new Map<string, SymbolEntry[]>();
  for (const [k, v] of snap.byFile.entries()) byFile.set(k, [...v]);
  const callGraphOut = new Map<DefKey, string[]>();
  for (const [k, v] of snap.callGraphOut.entries()) callGraphOut.set(k, [...v]);
  const vectors = new Map<DefKey, number[]>();
  for (const [k, v] of snap.vectors.entries()) vectors.set(k, [...v]);

  let fileCount = snap.fileCount;

  for (const rel of relPaths) {
    if (isIgnored(rel)) continue;
    const oldSyms = byFile.get(rel);
    if (oldSyms) {
      /* 清除 byName 中属于本文件的条目 */
      for (const s of oldSyms) {
        const dk = defKeyOf(s.file, s.name, s.line);
        vectors.delete(dk);
        callGraphOut.delete(dk);
        const arr = byName.get(s.name);
        if (arr) {
          const filtered = arr.filter((x) => !(x.file === rel && x.line === s.line));
          if (filtered.length === 0) byName.delete(s.name);
          else byName.set(s.name, filtered);
        }
      }
      byFile.delete(rel);
      fileCount = Math.max(0, fileCount - 1);
    }

    /* 文件是否还存在？不存在就只做清理 */
    const abs = join(snap.rootDir, rel);
    let exists = false;
    try {
      exists = await Bun.file(abs).exists();
    } catch {
      exists = false;
    }
    if (!exists) continue;

    const { symbols, calleesMap } = await scanFile(abs, rel);
    if (symbols.length === 0) continue;
    fileCount++;
    byFile.set(rel, symbols);
    for (const s of symbols) {
      const arr = byName.get(s.name) ?? [];
      arr.push(s);
      byName.set(s.name, arr);
      vectors.set(defKeyOf(s.file, s.name, s.line), generateEmbedding(embeddingInputOf(s)));
    }
    for (const [k, v] of calleesMap.entries()) callGraphOut.set(k, v);
  }

  return freezeSnapshot(snap.rootDir, byName, byFile, callGraphOut, vectors, fileCount);
}

/** 获取当前 rootDir 的 snapshot；必要时构建 */
async function getSnapshot(rootDir: string): Promise<IndexSnapshot> {
  const cached = cache.get(rootDir);
  if (cached) return cached;
  const snap = await buildIndex(rootDir);
  cache.set(rootDir, snap);
  /* 首次构建后落盘向量 */
  persistVectors(snap);
  return snap;
}

/** 归一化输入 path：绝对路径 → 相对 rootDir；相对路径保持不变 */
function toRelPath(rootDir: string, path: string): string {
  if (!path) return path;
  if (path.startsWith("/")) return relative(rootDir, path);
  return path;
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
    const snap = await getSnapshot(rootDir);
    const refs: ReferenceEntry[] = [];
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
        /* 跳过读不到的文件 */
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
    const target = toRelPath(rootDir, path);
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

/**
 * call_hierarchy：
 *   - callers：谁调用了 symbol（find_references 基础上排除定义行）
 *   - callees：symbol 的 function body 里调用了谁（AST 获得；需 tree-sitter 支持）
 *
 * callees 返回的 ReferenceEntry：
 *   - file = 调用方所在文件
 *   - line = 调用方定义起始行
 *   - content = 被调用的符号名
 */
async function callHierarchyImpl(
  ctx: { rootDir?: string },
  {
    symbol,
    direction = "callers",
  }: { symbol: string; direction?: "callers" | "callees" },
): Promise<ToolResult<ReferenceEntry[]>> {
  const rootDir = ctx.rootDir ?? "";
  if (!rootDir) return toolErr("rootDir 未设置");

  const snap = await getSnapshot(rootDir);

  if (direction === "callees") {
    /* 找到所有与该 symbol 同名的定义，合并 callees 返回 */
    const defs = snap.byName.get(symbol) ?? [];
    if (defs.length === 0) return toolOk([]);
    const out: ReferenceEntry[] = [];
    for (const d of defs) {
      const dk = defKeyOf(d.file, d.name, d.line);
      const callees = snap.callGraphOut.get(dk);
      if (!callees) continue;
      for (const callee of callees) {
        out.push({ file: d.file, line: d.line, content: callee });
      }
    }
    return toolOk(out);
  }

  /* callers */
  const refsRes = await findReferencesImpl(ctx, { symbol });
  if (!refsRes.ok) return refsRes;
  const defLines = new Set<string>();
  for (const s of snap.byName.get(symbol) ?? []) defLines.add(`${s.file}:${s.line}`);
  const callers = refsRes.data.filter((r) => !defLines.has(`${r.file}:${r.line}`));
  return toolOk(callers);
}

/**
 * semantic_search：对查询文本计算 embedding，cosineSimilarity 排序 topK
 *
 * 为保持与 v1 兼容：若 snapshot 的 vectors 为空（理论上新实现下不会；兜底逻辑），
 * 回退到 v1 的 token 相似度（保证上游不报错）。
 */
async function semanticSearchImpl(
  ctx: { rootDir?: string },
  { query, topK = 10 }: { query: string; topK?: number },
): Promise<ToolResult<Array<SymbolEntry & { score: number }>>> {
  const rootDir = ctx.rootDir ?? "";
  if (!rootDir) return toolErr("rootDir 未设置");
  if (!query || typeof query !== "string") return toolErr("query 必填");

  try {
    const snap = await getSnapshot(rootDir);

    if (snap.vectors.size === 0) {
      /* fallback：v1 token 相似度 */
      const tokens = query.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 0);
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
    }

    /* 真向量路径 */
    const qvec = generateEmbedding(query);
    const scored: Array<SymbolEntry & { score: number }> = [];
    for (const [, entries] of snap.byName.entries()) {
      for (const e of entries) {
        const dk = defKeyOf(e.file, e.name, e.line);
        const vec = snap.vectors.get(dk);
        if (!vec) continue;
        const sim = cosineSimilarity(qvec, [...vec]);
        if (sim <= 0) continue;
        scored.push({ ...e, score: sim });
      }
    }
    scored.sort((a, b) => b.score - a.score);
    return toolOk(scored.slice(0, topK));
  } catch (err: any) {
    return toolErr(`semantic_search 失败: ${err?.message ?? String(err)}`);
  }
}

/**
 * index_refresh：
 *   - 不传 paths → 整库重建（清空缓存 + 重扫）
 *   - 传 paths → 增量：只重扫这些文件（删/改/新增都支持）
 */
async function indexRefreshImpl(
  ctx: { rootDir?: string },
  { paths }: { paths?: string[] } = {},
): Promise<ToolResult<{ fileCount: number; symbolCount: number; builtAt: number; incremental: boolean; touched: number }>> {
  const rootDir = ctx.rootDir ?? "";
  if (!rootDir) return toolErr("rootDir 未设置");

  try {
    if (paths && paths.length > 0) {
      /* 增量路径 */
      const rels = paths.map((p) => toRelPath(rootDir, p));
      const cached = cache.get(rootDir);
      const base = cached ?? (await buildIndex(rootDir));
      const next = await applyIncremental(base, rels);
      cache.set(rootDir, next);
      persistVectors(next);
      let symbolCount = 0;
      for (const arr of next.byFile.values()) symbolCount += arr.length;
      return toolOk({
        fileCount: next.fileCount,
        symbolCount,
        builtAt: next.builtAt,
        incremental: true,
        touched: rels.length,
      });
    }

    /* 全量重建 */
    cache.delete(rootDir);
    const snap = await buildIndex(rootDir);
    cache.set(rootDir, snap);
    persistVectors(snap);
    let symbolCount = 0;
    for (const arr of snap.byFile.values()) symbolCount += arr.length;
    return toolOk({
      fileCount: snap.fileCount,
      symbolCount,
      builtAt: snap.builtAt,
      incremental: false,
      touched: snap.fileCount,
    });
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
    description: "按名精确查找代码符号的定义位置（tree-sitter AST + 正则 fallback）",
    params: [
      { name: "query", type: "string", description: "符号名", required: true },
      { name: "kind", type: "string", description: "function|class|interface|type|const", required: false },
      { name: "lang", type: "string", description: "ts|tsx|js|jsx|py|go|rs", required: false },
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
    description: "调用链分析（v2：支持 callers + callees 双向）",
    params: [
      { name: "symbol", type: "string", description: "符号名", required: true },
      { name: "direction", type: "string", description: "callers|callees", required: false },
    ],
    fn: callHierarchyImpl as TraitMethod["fn"],
  },
  semantic_search: {
    name: "semantic_search",
    description: "语义搜索（v2：向量余弦相似度，基于 name+signature+docstring）",
    params: [
      { name: "query", type: "string", description: "查询文本", required: true },
      { name: "topK", type: "number", description: "返回数量（默认 10）", required: false },
    ],
    fn: semanticSearchImpl as TraitMethod["fn"],
  },
  index_refresh: {
    name: "index_refresh",
    description: "重建代码索引（v2：传 paths 则增量，否则全量）",
    params: [
      { name: "paths", type: "string[]", description: "可选：增量刷新的文件相对路径（传入后只重扫这些文件）", required: false },
    ],
    fn: indexRefreshImpl as TraitMethod["fn"],
  },
};

export const ui_methods: Record<string, TraitMethod> = {};
