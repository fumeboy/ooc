/**
 * extractor —— 用 tree-sitter 解析文件并提取符号 + call graph
 *
 * 对外接口：
 *   parseAndExtract(text, lang) → { symbols, calleesBySymbolKey }
 *   - symbols：每个定义点的符号信息（含行号、签名、docstring、endLine）
 *   - calleesBySymbolKey：`${file?}:${name}@${line}` → callee 名称数组
 *     （extractor 不关心 file；调用方在拼接时附加）
 *
 * 设计：
 *   - 输入只关心 text + lang；extractor 不做 IO
 *   - query 初始化做了 per-lang 缓存（query 构造相对昂贵）
 *   - 同一 function body 内的 callees 去重
 *   - symbol kind 从 capture 名的前缀推断（fn / arrowFn / class / iface / type / const）
 *
 * @ref docs/工程管理/迭代/all/20260422_feature_code_index_v2.md — Phase 2
 */

import { loadLanguage, getParser, createQuery, type TSLangName } from "./tree-sitter-loader.js";
import {
  TS_SYMBOL_QUERY, TS_CALLEE_QUERY,
  JS_SYMBOL_QUERY, JS_CALLEE_QUERY,
  PY_SYMBOL_QUERY, PY_CALLEE_QUERY,
  GO_SYMBOL_QUERY, GO_CALLEE_QUERY,
  RUST_SYMBOL_QUERY, RUST_CALLEE_QUERY,
} from "./queries.js";

/** 与 code_index/index.ts 的 SymbolKind 对齐 */
export type ExtractedSymbolKind = "function" | "class" | "interface" | "type" | "const";

/** 提取出的单个符号（file 字段由调用方填入；extractor 只给 text/line 信息） */
export interface ExtractedSymbol {
  name: string;
  kind: ExtractedSymbolKind;
  /** 1-based 起始行 */
  line: number;
  /** 1-based 结束行（定义块结尾；无 body 的 type/const/iface 时 = line） */
  endLine: number;
  /** 简短签名（首行 trim，最多 200 字符） */
  signature: string;
  /** 函数/类定义上方紧邻的注释块合并为 docstring（最多 2000 字符；无则 ""） */
  docstring: string;
}

/** 一个函数定义的 callees（按定义 key 聚合） */
export interface ExtractedCallees {
  /** 属于哪个定义（name@line） */
  symbolKey: string;
  /** 被调用的名称（去重，保序） */
  callees: string[];
}

export interface ExtractResult {
  symbols: ExtractedSymbol[];
  callees: ExtractedCallees[];
}

/** capture 前缀 → kind 映射 */
const PREFIX_KIND: Record<string, ExtractedSymbolKind> = {
  fn: "function",
  arrowFn: "function",
  class: "class",
  iface: "interface",
  type: "type",
  const: "const",
};

/** Query 缓存（避免每次 parseAndExtract 重建 Query —— 构造相对昂贵） */
const queryCache = new Map<TSLangName, { symbolQ: any; calleeQ: any; lang: any }>();

/** 按语言分发 query 字符串 */
function querySourceOf(lang: TSLangName): { symbol: string; callee: string } {
  switch (lang) {
    case "typescript":
    case "tsx":
      return { symbol: TS_SYMBOL_QUERY, callee: TS_CALLEE_QUERY };
    case "javascript":
      return { symbol: JS_SYMBOL_QUERY, callee: JS_CALLEE_QUERY };
    case "python":
      return { symbol: PY_SYMBOL_QUERY, callee: PY_CALLEE_QUERY };
    case "go":
      return { symbol: GO_SYMBOL_QUERY, callee: GO_CALLEE_QUERY };
    case "rust":
      return { symbol: RUST_SYMBOL_QUERY, callee: RUST_CALLEE_QUERY };
  }
}

/** 获取（并缓存）指定语言的 Language + Query 实例 */
async function getLangResources(lang: TSLangName): Promise<{ symbolQ: any; calleeQ: any; lang: any }> {
  const cached = queryCache.get(lang);
  if (cached) return cached;
  const language = await loadLanguage(lang);
  const { symbol, callee } = querySourceOf(lang);
  const symbolQ = await createQuery(language, symbol);
  const calleeQ = await createQuery(language, callee);
  const r = { symbolQ, calleeQ, lang: language };
  queryCache.set(lang, r);
  return r;
}

/** 从一组 captures 里按名称找到指定 capture 的节点（可能多个；取第一个） */
function findCapture(captures: any[], name: string): any | null {
  for (const c of captures) if (c.name === name) return c.node;
  return null;
}

/** 从源码切出函数定义的第一行作为 signature（trim + 截断） */
function extractSignature(text: string, node: any): string {
  const startRow = node.startPosition.row;
  const lines = text.split("\n");
  const raw = lines[startRow] ?? "";
  const trimmed = raw.trim();
  return trimmed.length > 200 ? trimmed.slice(0, 200) + "..." : trimmed;
}

/**
 * 提取定义上方紧邻的注释块作为 docstring
 *
 * 规则：向上扫描，跳过空行，把 // 或 /* ... *\/ 或 # (Python) 合并为一段文本。
 * 合并最多 20 行，总长度截断到 2000 字符。
 */
function extractDocstring(text: string, node: any, lang: TSLangName): string {
  const startRow = node.startPosition.row;
  const lines = text.split("\n");
  const collected: string[] = [];

  for (let i = startRow - 1; i >= 0 && collected.length < 20; i--) {
    const ln = (lines[i] ?? "").trim();
    if (ln === "") {
      if (collected.length > 0) break;
      continue;
    }
    const isComment =
      (lang === "python" && ln.startsWith("#")) ||
      ln.startsWith("//") || ln.startsWith("*") || ln.startsWith("/*") || ln.endsWith("*/");
    if (!isComment) break;
    /* 去掉注释前缀 */
    const clean = ln
      .replace(/^\/\/\s?/, "")
      .replace(/^\/\*+\s?/, "")
      .replace(/\s?\*+\/\s*$/, "")
      .replace(/^\*+\s?/, "")
      .replace(/^#\s?/, "");
    collected.unshift(clean);
  }
  const joined = collected.join(" ").trim();
  return joined.length > 2000 ? joined.slice(0, 2000) : joined;
}

/**
 * 解析 + 提取符号 / call graph
 *
 * 返回数据严格去重：
 *  - 同一 (name, kind, line) 的 symbol 只出现一次
 *  - 同一 function body 的 callees 保序去重
 *
 * 失败时抛 Error（调用方负责回退到正则）
 */
export async function parseAndExtract(text: string, lang: TSLangName): Promise<ExtractResult> {
  const parser = await getParser();
  const { symbolQ, calleeQ, lang: language } = await getLangResources(lang);
  parser.setLanguage(language);
  const tree = parser.parse(text);
  if (!tree) throw new Error("tree-sitter parse 返回 null");
  const root = tree.rootNode;

  const symbols: ExtractedSymbol[] = [];
  const callees: ExtractedCallees[] = [];
  const seenSymKey = new Set<string>();

  for (const match of symbolQ.matches(root)) {
    /* 从 capture 前缀推断 kind；同一 pattern 可能同时有 .name 和 .body */
    let kind: ExtractedSymbolKind | null = null;
    let nameNode: any = null;
    let bodyNode: any = null;

    for (const c of match.captures) {
      const prefix = c.name.split(".")[0]!;
      const suffix = c.name.split(".")[1];
      const mapped = PREFIX_KIND[prefix];
      if (!mapped) continue;
      if (!kind) kind = mapped;
      if (suffix === "name") nameNode = c.node;
      else if (suffix === "body") bodyNode = c.node;
    }
    if (!kind || !nameNode) continue;

    const name = nameNode.text;
    const line = nameNode.startPosition.row + 1;
    const key = `${kind}:${name}@${line}`;
    if (seenSymKey.has(key)) continue;
    seenSymKey.add(key);

    /* endLine：body 存在则用 body；否则用 name 所在行 */
    const endRow = bodyNode ? bodyNode.endPosition.row : nameNode.endPosition.row;
    const signatureNode = bodyNode ?? nameNode;
    const sig = extractSignature(text, signatureNode.parent ?? signatureNode);
    const doc = extractDocstring(text, signatureNode.parent ?? signatureNode, lang);

    symbols.push({
      name,
      kind,
      line,
      endLine: endRow + 1,
      signature: sig,
      docstring: doc,
    });

    /* 仅对函数/类收集 callees（body 存在时才扫） */
    if (bodyNode && (kind === "function" || kind === "class")) {
      const seen = new Set<string>();
      const list: string[] = [];
      for (const cm of calleeQ.matches(bodyNode)) {
        for (const cap of cm.captures) {
          const text = cap.node.text;
          if (!text || seen.has(text)) continue;
          seen.add(text);
          list.push(text);
        }
      }
      if (list.length > 0) {
        callees.push({ symbolKey: `${name}@${line}`, callees: list });
      }
    }
  }

  return { symbols, callees };
}

/** 文件扩展名 → tree-sitter lang 名 */
export function tsLangOf(ext: string): TSLangName | null {
  const e = ext.toLowerCase();
  if (e === ".ts") return "typescript";
  if (e === ".tsx") return "tsx";
  if (e === ".js" || e === ".mjs" || e === ".cjs") return "javascript";
  if (e === ".jsx") return "tsx"; /* jsx 用 tsx grammar 处理 */
  if (e === ".py") return "python";
  if (e === ".go") return "go";
  if (e === ".rs") return "rust";
  return null;
}

/** 测试工具：清空 query 缓存 */
export function __resetExtractor(): void {
  queryCache.clear();
}
