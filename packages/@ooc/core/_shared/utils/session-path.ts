/**
 * Session-aware path 的**纯字符串操作部分** —— canonical 源（batch C8 从
 * `executable/windows/_shared/session-path.ts` 迁入）。
 *
 * **留在 executable**（依赖 `existsSync` / `process.cwd()`，违反零 IO 原则）：
 * - `resolveSessionPath`（读 process.cwd() fallback + ThreadContext）
 * - `classifyPackagesPath` / `classifyStonesPath`（用 existsSync 探 package.json）
 * - `__testing` 导出
 *
 * **迁入本文件**：path 分类结果 union 类型 + 两个 rewrite 纯函数。
 */

/**
 * stones-path 归属判定结果（旧命名兼容 union；write_file → versioning 路由用）。
 */
export type StonesPathClass =
  | { kind: "stone-object"; ownerObjectId: string; relInObjects: string }
  | { kind: "stones-world"; relInBranch: string }
  | { kind: "non-stone" };

/**
 * packages-path 归属判定结果。
 *
 * - kind="package-object"：落在某个 Object 的 package 自治区 → ownerObjectId + relInPackages
 * - kind="packages-world"：落在 packages/ 下但非某 Object 子目录（workspace-level 资源）
 * - kind="non-package"：不在 packages 树下（pools/ flows/ work/ 任意其它路径）→ 直写
 */
export type PackagesPathClass =
  | { kind: "package-object"; ownerObjectId: string; relInPackages: string }
  | { kind: "packages-world"; relInPackages: string }
  | { kind: "non-package" };

/**
 * 形如 `packages/<id>/...` 的路径：保持原样（bun workspace 已经是 packages/ 扁平根）。
 * 嵌套 Object 通过 children/ 物理目录分隔，物理路径与 LLM 写的路径一致。
 *
 * 为兼容旧 `stones/` 前缀，自动转成 `packages/`。纯字符串操作。
 */
export function rewritePackagesPath(p: string): string {
  const norm = p.replace(/\\/g, "/").replace(/^\.\//, "");
  // Legacy stones/ prefix → packages/
  if (norm.startsWith("stones/")) {
    return `packages/${norm.slice("stones/".length)}`;
  }
  // 已经是 packages/ → 直接使用
  if (norm.startsWith("packages/")) {
    return p;
  }
  return p;
}

/**
 * 形如 `pools/<id>/...` 的路径在 bun workspace 迁移后直接使用，不再需要
 * 注入 `objects/` 中间层（2026-06-01）。pools 不挂 branch（事实层单向累积，
 * 不跟着 metaprog branch 切换；详见 meta/object.doc.ts persistable.pool.no_branch patch）。
 *
 * 保留此函数作为 no-op 以便调用方保持统一接口。纯字符串操作。
 */
export function rewritePoolsPath(p: string): string {
  return p;
}
