/**
 * 虚拟路径解析（Phase 2）
 *
 * 三阶段 trait 激活 + relation 统一模型把"激活 trait"和"读关系文件"
 * 都折叠为「open 一个文件」。为了让 LLM 用统一的 open(path=...) 语法
 * 覆盖"我自己的 trait" / "对方关系" / "普通工程文件"三类，引入虚拟前缀：
 *
 * - `@trait:<namespace>/<name>`：指向 TRAIT.md
 *     - kernel → {root}/kernel/traits/<name>/TRAIT.md
 *     - library → {root}/library/traits/<name>/TRAIT.md
 *     - self 且 selfKind=stone → {root}/stones/{self}/traits/<name>/TRAIT.md
 *     - self 且 selfKind=flow_obj → {root}/flows/{sid}/objects/{self}/traits/<name>/TRAIT.md
 *
 * - `@relation:<peer>`：指向当前对象的关系文件
 *     - stone → {root}/stones/{self}/relations/<peer>.md
 *     - flow_obj → {root}/flows/{sid}/objects/{self}/relations/<peer>.md
 *
 * - 普通路径：视为相对 rootDir，拼接返回（非 null 前提是非空串）。
 *
 * 设计要点：
 * - **纯路径计算**：不触碰文件系统；存在性由调用方检查
 * - 未知 namespace / peer 缺失 / 不识别的 @ 前缀 → 返回 null（调用方按需兜底 inject 错误）
 *
 * @ref docs/superpowers/specs/2026-04-23-three-phase-trait-activation-design.md#虚拟路径
 */

import { join } from "node:path";

/** 虚拟路径解析上下文 */
export interface VirtualPathContext {
  /** 项目根目录（含 stones/, flows/, kernel/, library/） */
  rootDir: string;
  /** 当前对象名（用于 @trait:self/... 和 @relation:<peer> 的 self 路径定位） */
  selfName: string;
  /**
   * 当前对象类型：
   * - "stone"：目录在 `{root}/stones/{self}/`（默认）
   * - "flow_obj"：目录在 `{root}/flows/{sessionId}/objects/{self}/`
   */
  selfKind?: "stone" | "flow_obj";
  /** 当 selfKind="flow_obj" 时必须提供的 session ID */
  sessionId?: string;
}

/**
 * 判断字符串是否以虚拟前缀开头（`@<ns>:...` 形式）
 */
export function isVirtualPath(path: string): boolean {
  if (!path) return false;
  /* 简易判定：@ 开头且含冒号 */
  return /^@[A-Za-z_][A-Za-z0-9_]*:/.test(path);
}

/**
 * 将路径（虚拟或普通）解析为真实文件系统路径
 *
 * @param path 输入路径（`@trait:...` / `@relation:...` / 普通相对/绝对路径）
 * @param ctx  解析上下文
 * @returns 绝对路径字符串；解析失败返回 null
 */
export function resolveVirtualPath(
  path: string,
  ctx: VirtualPathContext,
): string | null {
  if (!path) return null;

  /* 1. 非虚拟路径：透传（绝对路径原样，相对路径相对 rootDir） */
  if (!isVirtualPath(path)) {
    if (path.startsWith("/")) return path;
    return join(ctx.rootDir, path);
  }

  /* 2. 拆前缀 */
  const colonIdx = path.indexOf(":");
  if (colonIdx < 0) return null;
  const prefix = path.slice(0, colonIdx); /* 如 "@trait" / "@relation" */
  const body = path.slice(colonIdx + 1); /* 冒号后的主体 */
  if (!body) return null;

  if (prefix === "@trait") {
    return resolveTraitPath(body, ctx);
  }
  if (prefix === "@relation") {
    return resolveRelationPath(body, ctx);
  }

  /* 3. 未识别的虚拟前缀 */
  return null;
}

/**
 * 解析 @trait: 主体（`<namespace>/<name>`）
 *
 * 必须同时有 namespace 和 name；否则 null。
 */
function resolveTraitPath(
  body: string,
  ctx: VirtualPathContext,
): string | null {
  const slashIdx = body.indexOf("/");
  if (slashIdx <= 0 || slashIdx === body.length - 1) return null;

  const namespace = body.slice(0, slashIdx);
  const name = body.slice(slashIdx + 1);
  if (!name) return null;

  const { rootDir, selfName, selfKind, sessionId } = ctx;

  if (namespace === "kernel") {
    return join(rootDir, "kernel", "traits", name, "TRAIT.md");
  }
  if (namespace === "library") {
    return join(rootDir, "library", "traits", name, "TRAIT.md");
  }
  if (namespace === "self") {
    if (selfKind === "flow_obj") {
      if (!sessionId) return null;
      return join(
        rootDir,
        "flows",
        sessionId,
        "objects",
        selfName,
        "traits",
        name,
        "TRAIT.md",
      );
    }
    return join(rootDir, "stones", selfName, "traits", name, "TRAIT.md");
  }

  /* 未知 namespace */
  return null;
}

/**
 * 解析 @relation: 主体（`<peer>`）
 *
 * self 对象的 relations/ 目录（stone 或 flow_obj）。
 */
function resolveRelationPath(
  peer: string,
  ctx: VirtualPathContext,
): string | null {
  if (!peer) return null;
  const { rootDir, selfName, selfKind, sessionId } = ctx;

  if (selfKind === "flow_obj") {
    if (!sessionId) return null;
    return join(
      rootDir,
      "flows",
      sessionId,
      "objects",
      selfName,
      "relations",
      `${peer}.md`,
    );
  }
  return join(rootDir, "stones", selfName, "relations", `${peer}.md`);
}
