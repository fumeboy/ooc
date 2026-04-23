/**
 * tree-sitter-loader —— Parser / Language 单例化加载器
 *
 * 背景：
 *   web-tree-sitter（WASM 绑定）的 Parser.init() 是全局一次性；
 *   Language.load(wasmPath) 每个 grammar 只需加载一次。
 *   我们按需加载每个语言的 grammar wasm，避免启动时全部加载带来的 ~几百 ms 延迟。
 *
 * 设计：
 *   - `initTreeSitter()` 幂等初始化 Parser 运行时
 *   - `loadLanguage(name)` 返回 Language，内部缓存
 *   - `getParser()` 返回一个可复用的 Parser；调用方 setLanguage 再 parse
 *   - 失败（wasm 找不到 / 初始化错）统一抛出 Error，调用方自行 try/catch 做 fallback
 *
 * 支持的 grammar：typescript / tsx / javascript / python / go / rust
 *
 * @ref docs/工程管理/迭代/all/20260422_feature_code_index_v2.md — Phase 1
 */

import { dirname, join } from "node:path";
import { existsSync } from "node:fs";

/** 支持的 tree-sitter 语法名 */
export type TSLangName = "typescript" | "tsx" | "javascript" | "python" | "go" | "rust";

/** 所有 grammar wasm 文件相对于 node_modules 的位置 */
const WASM_PATHS: Record<TSLangName, string> = {
  typescript: "tree-sitter-typescript/tree-sitter-typescript.wasm",
  tsx: "tree-sitter-typescript/tree-sitter-tsx.wasm",
  javascript: "tree-sitter-javascript/tree-sitter-javascript.wasm",
  python: "tree-sitter-python/tree-sitter-python.wasm",
  go: "tree-sitter-go/tree-sitter-go.wasm",
  rust: "tree-sitter-rust/tree-sitter-rust.wasm",
};

/** 缓存：Language 实例 */
const langCache = new Map<TSLangName, any>();
/** Parser 运行时初始化状态 */
let initialized = false;
/** 运行时可用性（首次 init 失败后置 false，后续直接 throw 避免反复报错） */
let runtimeAvailable = true;
/** 模块级 Parser 单例（设置 Language 前由调用方负责） */
let sharedParser: any = null;

/** 查找 node_modules 中 wasm 的绝对路径（逐层向上找 node_modules） */
function resolveWasm(name: TSLangName): string {
  const rel = WASM_PATHS[name];
  /* 从当前模块位置出发向上查 node_modules（优先 kernel 自己的 node_modules） */
  let dir = dirname(new URL(import.meta.url).pathname);
  while (dir && dir !== "/") {
    const candidate = join(dir, "node_modules", rel);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  /* cwd 兜底 */
  const cwdCandidate = join(process.cwd(), "node_modules", rel);
  if (existsSync(cwdCandidate)) return cwdCandidate;
  throw new Error(`tree-sitter grammar wasm 未找到：${rel}`);
}

/**
 * 幂等初始化 tree-sitter 运行时
 *
 * 失败不会污染后续调用（runtimeAvailable 置 false，直接抛错即可）
 */
export async function initTreeSitter(): Promise<void> {
  if (initialized) return;
  if (!runtimeAvailable) throw new Error("tree-sitter 运行时不可用（init 曾失败）");
  try {
    const mod: any = await import("web-tree-sitter");
    await mod.Parser.init();
    initialized = true;
  } catch (err: any) {
    runtimeAvailable = false;
    throw new Error(`tree-sitter 初始化失败: ${err?.message ?? err}`);
  }
}

/**
 * 按需加载某个语言的 grammar
 */
export async function loadLanguage(name: TSLangName): Promise<any> {
  await initTreeSitter();
  const cached = langCache.get(name);
  if (cached) return cached;
  const mod: any = await import("web-tree-sitter");
  const wasmPath = resolveWasm(name);
  const lang = await mod.Language.load(wasmPath);
  langCache.set(name, lang);
  return lang;
}

/** 获取共享 Parser 实例（调用方 setLanguage 再 parse） */
export async function getParser(): Promise<any> {
  await initTreeSitter();
  if (sharedParser) return sharedParser;
  const mod: any = await import("web-tree-sitter");
  sharedParser = new mod.Parser();
  return sharedParser;
}

/** 创建 Query 对象（不同语言的 query 字符串各异，放到 queries.ts 里） */
export async function createQuery(language: any, source: string): Promise<any> {
  const mod: any = await import("web-tree-sitter");
  return new mod.Query(language, source);
}

/** 是否仍可用（供上层做 fallback 决策） */
export function isTreeSitterAvailable(): boolean {
  return runtimeAvailable;
}

/** 测试工具：重置内部状态 */
export function __resetTreeSitter(): void {
  langCache.clear();
  initialized = false;
  runtimeAvailable = true;
  sharedParser = null;
}
