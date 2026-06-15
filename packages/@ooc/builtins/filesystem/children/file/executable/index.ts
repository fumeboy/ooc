/**
 * file —— executable 维度（object method）。
 *
 * object method 签名 `(ctx, self, args)`，self=Data（持 path），副作用经 ctx.thread / ctx.runtime。
 * 与 readable 维度（投影 + window method set_viewport/set_range，在 ../readable/index.ts）物理分离。
 *
 * 注册的 object method：reload / edit / close
 *   - reload：重新读文件（render 层每轮都会读，所以 reload 主要是语义提示）
 *   - edit：基于 "old → new" 做精确唯一替换；支持 array 形式做 atomic 多点修改（保留全部 worktree 版本化逻辑）
 *   - close：释放 window（runtime 关窗经 ctx.runtime）
 *
 * 构造（open_file / write_file 两分支）归 ../index.ts 的 `Class.construct`（其副作用 helper 在本目录的
 * ./construct.ts，与 edit 共享 worktree 落点解析）。
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type {
  ExecutableContext,
  ObjectMethod,
  ExecutableModule,
} from "@ooc/core/executable/contract.js";
import type { Data } from "../types.js";
import { isString } from "@ooc/builtins/_shared/executable/utils.js";
import { classifyPackagesPath } from "@ooc/core/persistable/session-path.js";
import { sessionUsesWorktree } from "@ooc/core/persistable/index.js";
import { resolveStoneWorktreeTarget } from "./construct.js";

const reloadMethod: ObjectMethod<Data> = {
  name: "reload",
  description: "Reload file content from disk (render re-reads each turn; this is a semantic hint).",
  exec: () => undefined,
};

const closeMethod: ObjectMethod<Data> = {
  name: "close",
  description: "Close this file window (does not delete the file on disk).",
  exec: () => undefined,
};

interface EditPair {
  old: string;
  new: string;
}

function parseEdits(args: Record<string, unknown>): EditPair[] | undefined {
  if (isString(args.old) && isString(args.new)) {
    return [{ old: args.old, new: args.new }];
  }
  if (Array.isArray(args.edits)) {
    const out: EditPair[] = [];
    for (let i = 0; i < args.edits.length; i += 1) {
      const item = args.edits[i] as Record<string, unknown> | undefined;
      if (!item || !isString(item.old) || !isString(item.new)) return undefined;
      out.push({ old: item.old, new: item.new });
    }
    return out.length > 0 ? out : undefined;
  }
  return undefined;
}

function applyEdits(
  initial: string,
  edits: EditPair[],
): { ok: true; result: string } | { ok: false; error: string } {
  let buffer = initial;
  for (let i = 0; i < edits.length; i += 1) {
    const e = edits[i]!;
    let count = 0;
    let pos = 0;
    while (true) {
      const idx = buffer.indexOf(e.old, pos);
      if (idx === -1) break;
      count += 1;
      pos = idx + Math.max(e.old.length, 1);
      if (count > 1) break;
    }
    if (count === 0) {
      return { ok: false, error: `edit #${i}: oldString not found` };
    }
    if (count > 1) {
      let total = 0;
      let p2 = 0;
      while (true) {
        const idx = buffer.indexOf(e.old, p2);
        if (idx === -1) break;
        total += 1;
        p2 = idx + Math.max(e.old.length, 1);
      }
      return { ok: false, error: `edit #${i}: oldString matches ${total} times (must match exactly once)` };
    }
    buffer = buffer.replace(e.old, e.new);
  }
  return { ok: true, result: buffer };
}

const editMethod: ObjectMethod<Data> = {
  name: "edit",
  description: "Precise unique-string replacement on the file; supports atomic multi-edit.",
  schema: {
    args: {
      old: { type: "string", description: "要替换的旧字符串（必须在文件中正好出现一次）" },
      new: { type: "string", description: "替换后的新字符串" },
      edits: { type: "array", description: "批量替换 [{old, new}, ...]，与 old/new 二选一" },
    },
  },
  exec: async (ctx: ExecutableContext, self: Data, args: Record<string, unknown>) => {
    const edits = parseEdits(args);
    if (!edits) {
      return "[file_window.edit] 缺少 args={ old, new } 或 args={ edits: [{old, new}, ...] }。";
    }

    const wtTarget = await resolveStoneWorktreeTarget(ctx.thread, self.path, "write");
    let readPath = self.path;
    let writePath = self.path;
    let toWorktree = false;
    if (wtTarget) {
      readPath = wtTarget;
      writePath = wtTarget;
      toWorktree = true;
    } else {
      const baseDir = ctx.thread?.persistence?.baseDir;
      const sessionId = ctx.thread?.persistence?.sessionId;
      if (baseDir && sessionUsesWorktree(sessionId)) {
        const stoneClass = classifyPackagesPath(self.path, baseDir);
        if (stoneClass.kind === "package-object") {
          return (
            `[file_window.edit] 无法为 session ${sessionId} 建立 worktree 落点（${self.path}）；` +
            `绝不裸写 main 绕过版本化。`
          );
        }
      }
    }

    let buffer: string;
    try {
      buffer = await readFile(readPath, "utf8");
    } catch (err) {
      return `[file_window.edit] 读取 ${readPath} 失败：${(err as Error).message}`;
    }

    const result = applyEdits(buffer, edits);
    if (result.ok === false) {
      return `[file_window.edit] ${readPath}: ${result.error}`;
    }

    try {
      if (toWorktree) await mkdir(dirname(writePath), { recursive: true });
      await writeFile(writePath, result.result, "utf8");
    } catch (err) {
      return `[file_window.edit] 写回 ${writePath} 失败：${(err as Error).message}`;
    }

    if (toWorktree && ctx.thread?.events) {
      const onFeatBranch = !!ctx.thread.persistence?.stonesBranch;
      ctx.thread.events.push({
        category: "context_change",
        kind: "inject",
        text: onFeatBranch
          ? `[file_window.edit] 改动落在 feat 分支 worktree（${writePath}），main 未变。` +
            `编辑完调 create_pr_and_invite_reviewers 提交并开 PR 交 review 合入。`
          : `[file_window.edit] 改动落在本 session 的 worktree（${writePath}），main 未变。` +
            `经 super flow new_feat_branch + 直接编辑 + create_pr_and_invite_reviewers 开 PR 合入 main 才永久生效。`,
      });
    }

    return undefined;
  },
};

const executable: ExecutableModule<Data> = {
  methods: [reloadMethod, editMethod, closeMethod],
};

export default executable;
