/**
 * file —— constructor（open_file / write_file 两分支）+ 与 edit 共享的 worktree 落点解析。
 *
 * `construct.exec(ctx, args) => Data`（ConstructorContext，无 object 信封）：保留全部路径解析 /
 * worktree 版本化 / 写盘 / events 注入逻辑。失败 **throw**（runtime 捕获、不建窗），而非旧的
 * `{ ok:false, error }`。产出新实例初始 Data `{ path }`（path = 实际读写落点，含 worktree 重定向）。
 *
 * 分支判别（取代旧 ctx.form.method）：args 带 `content:string` → write_file，否则 open_file。
 *
 * 投影态（viewport / lines / columns）不再进 Data，由 readable 维度的 win 默认值 + window method 控制
 * （open_file 旧版预填的 lines/columns 已不在构造侧落地——见 NEXT/notes）。
 */

import { mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { ConstructorContext, ObjectConstructor } from "@ooc/core/executable/contract.js";
import type { ThreadContext } from "@ooc/core/_shared/types/thread.js";
import type { Data } from "../types.js";
import {
  classifyPackagesPath,
  relWithinObjectFromPackages,
  resolveSessionPath,
} from "@ooc/core/extendable/_shared/session-path.js";
import {
  sessionUsesWorktree,
  resolveStoneIdentityRef,
} from "@ooc/core/persistable/index.js";
import { stoneDir } from "@ooc/core/persistable/common.js";
import { isString } from "@ooc/builtins/_shared/executable/utils.js";

/**
 * 解析「编辑/写入该绝对路径时应落到的 stone worktree 目标」。
 *
 * 与 edit object method 共享：feat 分支绑定（reflectable 沉淀）或业务 session worktree 命中
 * stone 自治区时，把 main 路径重定向到 worktree 落点；否则返回 undefined（裸路径）。
 */
export async function resolveStoneWorktreeTarget(
  thread: ThreadContext | undefined,
  absPath: string,
  mode: "read" | "write",
): Promise<string | undefined> {
  const baseDir = thread?.persistence?.baseDir;
  const sessionId = thread?.persistence?.sessionId;
  // feat 分支绑定（reflectable 沉淀，super(foo) 直接编辑）也要路由——不只 business session。
  const stonesBranch = thread?.persistence?.stonesBranch;
  if (!baseDir || (!sessionUsesWorktree(sessionId) && !stonesBranch)) return undefined;
  // feat 分支沉淀允许新建对象（package.json 尚不在 main / feat worktree）→ 结构化判 owner。
  const stoneClass = classifyPackagesPath(absPath, baseDir, { allowNewObject: !!stonesBranch });
  if (stoneClass.kind !== "package-object") return undefined;
  const targetObjectId = stoneClass.ownerObjectId;
  const rel = relWithinObjectFromPackages(targetObjectId, stoneClass.relInPackages);
  if (!rel) return undefined;
  const wtRef = await resolveStoneIdentityRef(
    { baseDir, sessionId, objectId: targetObjectId, stonesBranch },
    mode,
  );
  if (!wtRef._stonesBranch) return undefined;
  return join(stoneDir(wtRef), ...rel.split("/").filter(Boolean));
}

async function constructWriteFile(thread: ThreadContext, args: Record<string, unknown>): Promise<Data> {
  const rawPath = isString(args.path) ? args.path : "";
  if (!rawPath) throw new Error("[write_file] 缺少 path 参数。");
  const content = args.content;
  if (typeof content !== "string") {
    throw new Error("[write_file] 缺少 content 参数（应是字符串，可为空）。");
  }
  const path = resolveSessionPath(thread, rawPath);
  const baseDir = thread.persistence?.baseDir;
  // feat 分支沉淀允许新建对象（package.json 尚不在 main / feat worktree）→ 结构化判 owner。
  const stoneClass = classifyPackagesPath(path, baseDir, {
    allowNewObject: !!thread.persistence?.stonesBranch,
  });

  let preExisted = false;
  if (stoneClass.kind !== "package-object" && stoneClass.kind !== "packages-world") {
    try {
      const s = await stat(path);
      preExisted = s.isFile();
    } catch {
      /* 不存在 → 新建 */
    }
  }

  if (stoneClass.kind === "package-object") {
    const authorObjectId = thread.persistence?.objectId;
    if (!baseDir || !authorObjectId) {
      throw new Error(
        `[write_file] 路径落在 packages 自治区 (${path}) 需走 versioning，但当前 thread ` +
          `缺少 ${!baseDir ? "persistence.baseDir" : "persistence.objectId"}，无法版本化写入。`,
      );
    }

    const sessionId = thread.persistence?.sessionId;
    // feat 分支绑定（reflectable 沉淀，super(foo) 直接编辑）也放行——不只 business session。
    const stonesBranch = thread.persistence?.stonesBranch;
    const targetObjectId = stoneClass.ownerObjectId;
    const relWithinObject = relWithinObjectFromPackages(
      targetObjectId,
      stoneClass.relInPackages,
    );
    if (!sessionUsesWorktree(sessionId) && !stonesBranch) {
      throw new Error(
        `[write_file] 路径落在 stone 自治区 (${path})，需在业务 session 的 worktree 或 feat 分支绑定下写入，` +
          `但当前既非业务 session（sessionId=${sessionId ?? "<none>"}）也无 feat 绑定。` +
          `沉淀请先在 super flow 调 new_feat_branch；控制面写请走 HTTP versioning endpoint。`,
      );
    }
    if (!relWithinObject) {
      throw new Error(
        `[write_file] 无法把 ${path} 解析到对象 ${targetObjectId} 的 stone 根（relInPackages=${stoneClass.relInPackages}）。`,
      );
    }
    const wtRef = await resolveStoneIdentityRef(
      { baseDir, sessionId, objectId: targetObjectId, stonesBranch },
      "write",
    );
    if (!wtRef._stonesBranch) {
      throw new Error(
        `[write_file] 无法为 session ${sessionId} 建立 worktree 落点（写入 ${path} 失败）。` +
          `绝不裸写 main 绕过版本化。`,
      );
    }
    const wtTarget = join(stoneDir(wtRef), ...relWithinObject.split("/").filter(Boolean));
    try {
      await mkdir(dirname(wtTarget), { recursive: true });
      await writeFile(wtTarget, content, "utf8");
    } catch (err) {
      throw new Error(`[write_file] 写入 worktree ${wtTarget} 失败：${(err as Error).message}`);
    }
    const isOwnStone = targetObjectId === authorObjectId;
    if (thread.events) {
      // feat 分支绑定下（reflectable 沉淀 super(foo) 直接编辑）：改动落 feat worktree，
      // 经 create_pr_and_invite_reviewers commit + 开 PR；与 business session worktree 文案区分。
      const onFeatBranch = !!stonesBranch;
      thread.events.push({
        category: "context_change",
        kind: "inject",
        text: onFeatBranch
          ? `[write_file] ${path} 的改动落在 feat 分支 worktree（${wtTarget}），main 未变。` +
            `继续 write_file / file_window.edit 编辑，编辑完调 create_pr_and_invite_reviewers 提交并开 PR 交 review 合入。`
          : isOwnStone
            ? `[write_file] ${path} 的改动落在本 session 的 worktree（${wtTarget}），` +
              `main 未变。本 session 内即时生效；要把它沉淀为正式身份，去 super flow 调 ` +
              `new_feat_branch + 直接编辑 + create_pr_and_invite_reviewers 开 PR 合入 main 才永久生效。`
            : `[write_file] 你改/建了别人的对象 ${targetObjectId}（${path}），改动落在本 session 的 ` +
              `worktree（${wtTarget}），main 未变。本 session 内即时生效；经 super flow new_feat_branch 沉淀时，` +
              `因越出你的自治区将开 PR-Issue 等 Supervisor 评审后才合入 main。`,
      });
    }
    return { path: wtTarget };
  } else if (stoneClass.kind === "packages-world") {
    throw new Error(
      `[write_file] 路径 ${path} 落在 stones/main/ 根但不在某个 Object 的 ` +
        `子目录内（workspace-level 资源）。这类资源不能通过 write_file 修改。`,
    );
  } else {
    try {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, content, "utf8");
    } catch (err) {
      throw new Error(`[write_file] 写入 ${path} 失败：${(err as Error).message}`);
    }
    // feat 分支绑定生效时，落在 stone 自治区**之外**
    // 的写（典型 pools/ 知识/记忆路径）是 write-through——立即生效、**不进本 PR**、
    // 不在 feat worktree。此前静默无提示 → 随后 create_pr_and_invite_reviewers 发现 feat 分支无 stone
    // 改动报 NO_CHANGES，LLM 不知为何。这里显式点破两通道，消除静默 + 困惑。
    if (thread.persistence?.stonesBranch && thread.events) {
      thread.events.push({
        category: "context_change",
        kind: "inject",
        text:
          `[write_file] 你在 feat 沉淀绑定（${thread.persistence.stonesBranch}）中，但 ${path} ` +
          `落在 stone 自治区之外，是 write-through 写——立即生效、不进本 PR、不在 feat 分支。` +
          `若你只想沉淀知识/记忆（pool），写完即生效，无需 create_pr_and_invite_reviewers（feat 分支无 stone 改动会报 NO_CHANGES）。` +
          `若要改身体/身份并经 PR review 合入，请写 stone 路径 stones/<self>/...（objects/...）。`,
      });
    }
  }
  if (preExisted && thread.events) {
    thread.events.push({
      category: "context_change",
      kind: "inject",
      text:
        `[write_file hint] 你刚整文件覆盖了已有文件 ${path}。如果你的意图是"修改局部"` +
        `（而不是完整重写），下次请改走 file_window.edit：先 open_file 把文件载入 file_window，` +
        `再 open(parent_window_id=<file_window_id>, method="edit", args={ old, new })。` +
        `write_file 适合新建文件或确实要丢弃整个旧版本的场景。`,
    });
  }
  return { path };
}

async function constructOpenFile(thread: ThreadContext, args: Record<string, unknown>): Promise<Data> {
  const rawPath = isString(args.path) ? args.path : "";
  if (!rawPath) throw new Error("[open_file] 缺少 path。");
  let path = resolveSessionPath(thread, rawPath);
  const openWtTarget = await resolveStoneWorktreeTarget(thread, path, "read");
  if (openWtTarget) path = openWtTarget;
  try {
    await stat(path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`[open_file] 文件不存在: ${path}`);
    }
    throw new Error(`[open_file] 校验 path 失败: ${(err as Error).message}`);
  }
  return { path };
}

export const construct: ObjectConstructor<Data> = {
  description: "Open an existing file (read-only window) or write new content to a file.",
  schema: {
    args: {
      path: { type: "string", required: true, description: "文件路径（相对 session baseDir）" },
      content: { type: "string", description: "要写入的文件内容；提供时走 write_file 分支" },
      lines: { type: "array", description: "可选 [start, end]，open_file 时指定可见行范围" },
      columns: { type: "array", description: "可选 [start, end]，open_file 时指定可见列范围" },
    },
  },
  exec: async (ctx: ConstructorContext, args: Record<string, unknown>): Promise<Data> => {
    const thread = ctx.thread;
    if (!thread) throw new Error("[file] 缺少 thread context。");
    const isWrite = typeof args.content === "string";
    return isWrite ? constructWriteFile(thread, args) : constructOpenFile(thread, args);
  },
};
