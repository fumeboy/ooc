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
 * 工作目录"，是 raw escape hatch（详见 src/executable/windows/root/method.program.ts 的
 * KNOWLEDGE）。
 */

import { existsSync } from "node:fs";
import { isAbsolute, relative, resolve, sep, join } from "node:path";
import type { ThreadContext } from "../../../thinkable/context";
import { nestedObjectPath } from "../../../_shared/types/thread";

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
 * P1 路径收口（2026-06-05）：agent 的概念 stone 根 `stones/<self>/...` → 物理 canonical
 * `stones/main/objects/<self>/...`（main 分支 worktree，stoneDir 默认）。
 * 取代旧的 `stones/<id>` → `packages/<id>` rewrite（packages/ 空/deprecated，是布局分叉的根之一）。
 * 已经是物理 `stones/main/objects/...` 的路径不重复映射；`packages/...`（builtin）保持原样。
 * 嵌套 Object 通过 children/ 物理目录分隔——本 string 级映射只处理常见的单层 id（self 自身根）；
 * 跨嵌套对象的 children/ 由后续 overlay/解析器层精化（P2/P3）。
 */
function rewritePackagesPath(p: string): string {
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
  // P1 收口（2026-06-05）：canonical 对象根 = stones/main/objects/（main worktree），取代旧 packages/ 根。
  // relInPackages 语义不变（相对对象根的路径，如 agent_of_x/self.md）——消费方 join(wt.path,"objects",relInPackages) 不受影响。
  const objectsRoot = resolve(baseDir, "stones", "main", "objects");
  const relObjects = relative(objectsRoot, resolve(absPath));
  const underObjects = relObjects !== "" && !relObjects.startsWith("..") && !isAbsolute(relObjects);

  if (underObjects) {
    const segs = relObjects.split(sep).filter(Boolean);
    // 向前扫到最深含 package.json 的目录（flat "agent" 或 nested "a/children/b"）
    let currentPath = objectsRoot;
    const objectIdSegments: string[] = [];
    let foundPackage = false;
    let i = 0;
    while (i < segs.length) {
      const seg = segs[i]!;
      if (seg === "children" && i + 1 < segs.length) {
        i++;
        const childSeg = segs[i]!;
        currentPath = join(currentPath, "children", childSeg);
        objectIdSegments.push(childSeg);
      } else {
        currentPath = join(currentPath, seg);
        if (objectIdSegments.length === 0) {
          objectIdSegments.push(seg);
        } else {
          break; // 进入 object 目录内部的文件路径
        }
      }
      if (existsSync(join(currentPath, "package.json"))) foundPackage = true;
      i++;
    }
    if (foundPackage && objectIdSegments.length > 0) {
      return { kind: "package-object", ownerObjectId: objectIdSegments.join("/"), relInPackages: relObjects };
    }
    // objects/ 下但未命中 package.json（如 objects/ 根散落文件）→ workspace-level
    return { kind: "packages-world", relInPackages: relObjects };
  }

  // stones/main/ 下但不在 objects/（如 stones/main/.gitignore）→ workspace-level 资源（fail-loud）
  const worktreeRoot = resolve(baseDir, "stones", "main");
  const relWorktree = relative(worktreeRoot, resolve(absPath));
  if (relWorktree !== "" && !relWorktree.startsWith("..") && !isAbsolute(relWorktree)) {
    return { kind: "packages-world", relInPackages: relWorktree };
  }
  return { kind: "non-package" };
}

/**
 * 把 classifyPackagesPath 给出的 `relInPackages`（相对 `stones/main/objects/` 根，含 owner
 * 段 + children/ marker，如 `a/children/b/self.md`）转成相对 object stone 根的
 * `relWithinObject`（如 `self.md`），通过剥掉 owner 的 nestedObjectPath 物理前缀。
 *
 * 与 classifyPackagesPath 互逆，供 worktree 写重定向（file builtin write_file/edit）把
 * 落点拼回该 session worktree 的 object 目录。
 *
 * @returns relWithinObject；若 relInPackages 不以 owner 物理前缀起头返回 undefined（防御）。
 */
export function relWithinObjectFromPackages(
  ownerObjectId: string,
  relInPackages: string,
): string | undefined {
  const prefixSegs = nestedObjectPath(ownerObjectId);
  const segs = relInPackages.split("/").filter(Boolean);
  if (segs.length < prefixSegs.length) return undefined;
  for (let i = 0; i < prefixSegs.length; i += 1) {
    if (segs[i] !== prefixSegs[i]) return undefined;
  }
  return segs.slice(prefixSegs.length).join("/");
}

export const __testing = { rewritePackagesPath, rewritePoolsPath, classifyPackagesPath };
