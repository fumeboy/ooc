/**
 * Session-aware path 解析。
 *
 * OOC 设计：每个 session 持有一个 baseDir（通过 `--world` 启动；持久化到
 * thread.persistence.baseDir）。数据原语 (grep / glob / write_file / open_file /
 * file_window.edit) 接收 LLM 传入的相对路径时，应当解析到 baseDir，而不是
 * OOC 进程的 cwd——后者在多 session / 服务化场景毫无意义。
 *
 * packages routing（2026-06-01 bun workspace 迁移）：
 * 当路径形如 `packages/<objectId>/...` 时，保持原样（bun workspace 把所有 objects
 * 都放在 packages/ 下，嵌套通过 children/ 物理目录分隔）。
 *   - 简单 objectId: `packages/supervisor/readme.md`
 *   - 嵌套 objectId: `packages/sentry/children/sentry_factor_dev/readme.md`
 *
 * pools routing（2026-05-23 起）：当路径形如 `pools/<id>/...` 时，自动重写为
 * `pools/objects/<id>/...`：
 *   - pools 不挂 branch（事实是单向积累的；详见 meta/object.doc.ts persistable.pool.no_branch patch）。
 *   - 已经形如 `pools/objects/...` 的路径不重写。
 *
 * 注意：program(language="shell") 不走这里——shell 显式承诺"cwd 等于 OOC 进程的
 * 工作目录"，是 raw escape hatch（详见 src/executable/windows/root/command.program.ts 的
 * KNOWLEDGE）。
 */

import { existsSync } from "node:fs";
import { isAbsolute, relative, resolve, sep, join } from "node:path";
import type { ThreadContext } from "../../../thinkable/context";

/**
 * 把 LLM 传入的路径解析为绝对路径：
 * - 绝对路径：原样返回
 * - 相对路径 + thread.persistence.baseDir 已知：相对 baseDir 解析；
 *   形如 `packages/<id>/...` 的路径直接使用（bun workspace 结构）；
 *   形如 `pools/<id>/...` 的路径自动注入 `objects/`
 * - 相对路径 + baseDir 未知：回退 process.cwd()（仅纯内存测试场景）
 */
export function resolveSessionPath(thread: ThreadContext | undefined, p: string): string {
  const baseDir = thread?.persistence?.baseDir;
  if (!baseDir) {
    // 无 world 根（纯内存测试场景）：无边界可 clamp，保持旧行为。
    return isAbsolute(p) ? p : resolve(process.cwd(), p);
  }

  const packagesRewritten = rewritePackagesPath(p);
  const rewritten = rewritePoolsPath(packagesRewritten);
  const resolved = isAbsolute(rewritten) ? rewritten : resolve(baseDir, rewritten);

  // 安全（harness executable 发现：`write_file{path:"../escape.txt"}` 写到 world 根之外，无拦截）：
  // data 原语（grep / glob / write_file / open_file / file_window.edit）不得读写 world 目录之外。
  // `../` 相对逃逸 + world 外绝对路径一律拒绝；需 world 外操作请用 program(shell)（另设的 raw escape hatch，不走这里）。
  const rel = relative(baseDir, resolved);
  if (rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel)) {
    throw new Error(
      `路径 "${p}" 逃逸出 world 根（解析为 "${resolved}"）；data 原语只能在 world 目录内读写。`,
    );
  }
  return resolved;
}

/**
 * 形如 `packages/<id>/...` 的路径：保持原样（bun workspace 已经是 packages/ 扁平根）。
 * 嵌套 Object 通过 children/ 物理目录分隔，物理路径与 LLM 写的路径一致。
 *
 * 为兼容旧 `stones/` 前缀，自动转成 `packages/`。
 */
function rewritePackagesPath(p: string): string {
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
 * 保留此函数作为 no-op 以便调用方保持统一接口。
 */
function rewritePoolsPath(p: string): string {
  return p;
}

/**
 * packages-path 归属判定（write_file → versioning 路由用）。
 *
 * 输入是 `resolveSessionPath` 已解析好的**绝对**路径 + 当前 session 的 baseDir。
 * 判断该路径是否落在某个 Object 的 package 自治区 `${baseDir}/packages/<objectId>/...` 下：
 *
 * - kind="package-object"：是 → 返回 ownerObjectId（路径所属 Object）+ relInPackages
 *   （相对 `packages/` 的剩余路径，含 owner 段，供写入时拼回落点）。
 * - kind="packages-world"：落在 `packages/` 下但不在某个 Object 的子目录里
 *   （workspace-level 资源，如 packages/package.json）→ caller fail-loud，不静默直写。
 * - kind="non-package"：不在 packages 树下（pools/ flows/ work/ 任意其它路径）→ 直写。
 */
export type PackagesPathClass =
  | { kind: "package-object"; ownerObjectId: string; relInPackages: string }
  | { kind: "packages-world"; relInPackages: string }
  | { kind: "non-package" };

export function classifyPackagesPath(
  absPath: string,
  baseDir: string | undefined,
): PackagesPathClass {
  if (!baseDir) return { kind: "non-package" };
  const packagesRoot = resolve(baseDir, "packages");
  const rel = relative(packagesRoot, resolve(absPath));
  // 越出 packages/ 树（rel 以 .. 开头或为绝对路径）→ 非 package
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) return { kind: "non-package" };

  const segs = rel.split(sep).filter(Boolean);
  if (segs.length === 0) return { kind: "non-package" };

  // Scan forward to find the deepest directory that contains a package.json (i.e., a valid object package)
  // This handles both flat "supervisor" and nested "sentry/children/sentry_factor_dev" layouts
  let currentPath = packagesRoot;
  let objectIdSegments: string[] = [];
  let foundPackage = false;
  let i = 0;

  while (i < segs.length) {
    const seg = segs[i]!;
    if (seg === "children" && i + 1 < segs.length) {
      // children/ is a marker, not part of the objectId; skip it and take the next seg as objectId part
      i++;
      const childSeg = segs[i]!;
      currentPath = join(currentPath, "children", childSeg);
      objectIdSegments.push(childSeg);
    } else {
      currentPath = join(currentPath, seg);
      if (objectIdSegments.length === 0) {
        objectIdSegments.push(seg);
      } else {
        // We've passed the object directory into its contents (file path inside object)
        break;
      }
    }
    // Check if this is a valid object package (has package.json)
    if (existsSync(join(currentPath, "package.json"))) {
      foundPackage = true;
    }
    i++;
  }

  if (foundPackage && objectIdSegments.length > 0) {
    const ownerObjectId = objectIdSegments.join("/");
    // relInPackages is the full relative path from packages/
    const relInPackages = segs.join("/");
    return { kind: "package-object", ownerObjectId, relInPackages };
  }

  // packages/ 下但不在某个 object 目录里 → workspace-level 资源
  return { kind: "packages-world", relInPackages: segs.join("/") };
}

export const __testing = { rewritePackagesPath, rewritePoolsPath, classifyPackagesPath };
