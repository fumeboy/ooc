/**
 * Session path 纯函数 —— packages / pools 路径改写，**零 IO**。
 *
 * 与 `executable/session-path.ts` 的 IO 部分（`resolveSessionPath` / `classifyPackagesPath`，
 * 依赖 `existsSync` / `process.cwd()` / world config）分离：纯 string 改写归 `_shared/utils`
 * （符合 `_shared` 零 IO 约束），IO 解析留在 executable。
 */

/**
 * 路径收口：agent 的概念 stone 根 `stones/<self>/...` → 物理 canonical
 * `stones/main/objects/<self>/...`（main 分支 worktree，stoneDir 默认）。
 * 取代旧的 `stones/<id>` → `packages/<id>` rewrite（packages/ 空/deprecated，是布局分叉的根之一）。
 * 已经是物理 `stones/main/objects/...` 的路径不重复映射；`packages/...`（builtin）保持原样。
 * 嵌套 Object 通过 children/ 物理目录分隔——本 string 级映射只处理常见的单层 id（self 自身根）；
 * 跨嵌套对象的 children/ 由后续 overlay/解析器层精化。
 */
export function rewritePackagesPath(p: string): string {
  const norm = p.replace(/\\/g, "/").replace(/^\.\//, "");
  // 显式 main 分支路径 stones/main/...（含 objects/<id>/ 与 main 根资源如 .gitignore）→ 原样。
  // 避免对物理路径双重注入；main 根下非 objects/ 资源交给 classifyPackagesPath 判 workspace-level(fail-loud)。
  if (norm.startsWith("stones/main/")) {
    return p;
  }
  // agent 概念 stone 根 stones/<id>/... → 物理 canonical stones/main/objects/<id>/...（main worktree）
  if (norm.startsWith("stones/")) {
    return `stones/main/objects/${norm.slice("stones/".length)}`;
  }
  // packages/（builtin）→ 直接使用
  if (norm.startsWith("packages/")) {
    return p;
  }
  return p;
}

/**
 * 形如 `pools/<id>/...` 的路径在 bun workspace 迁移后直接使用，不再需要
 * 注入 `objects/` 中间层。pools 不挂 branch（事实层单向累积，
 * 不跟着 metaprog branch 切换）。
 *
 * 保留此函数作为 no-op 以便调用方保持统一接口。
 */
export function rewritePoolsPath(p: string): string {
  return p;
}
