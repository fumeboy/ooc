/**
 * root.evolve_self method — super-flow 身份合入闸门。
 */

import type {
  MethodExecutionContext,
  ObjectMethod,
} from "@ooc/core/extendable/_shared/method-types.js";
import {
  evolveSelfDiff,
  evolveSelfMerge,
} from "@ooc/core/persistable/index.js";
import { isSuperSessionId } from "@ooc/core/_shared/types/constants.js";

function asString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

export const evolveSelfMethod: ObjectMethod = {
  description: "In super flow: diff or merge the triggering business session's worktree changes into canonical main.",
  intents: ["evolve_self"],
  exec: (ctx) => executeEvolveSelf(ctx),
};

export async function executeEvolveSelf(ctx: MethodExecutionContext): Promise<string | undefined> {
  const thread = ctx.thread;
  if (!thread) return "[evolve_self] 缺少 thread context。";
  if (!thread.persistence) return "[evolve_self] thread 无 persistence。";

  const { baseDir, sessionId, objectId } = thread.persistence;
  if (!isSuperSessionId(sessionId)) {
    return `[evolve_self] 仅 super flow 内可用（当前 session='${sessionId}'）。请在业务 thread 里 talk(target="super") 触发 super flow 后再调。`;
  }

  const creatorSessionId = thread.creatorSessionId;
  if (!creatorSessionId || isSuperSessionId(creatorSessionId)) {
    return "[evolve_self] 拿不到触发本 super flow 的业务 session（thread.creatorSessionId 缺失）。";
  }

  const message = asString(ctx.args.message);

  if (!message || !message.trim()) {
    const diff = await evolveSelfDiff(baseDir, objectId, creatorSessionId);
    if (diff.files.length === 0) {
      return JSON.stringify({
        ok: true,
        kind: "diff",
        files: [],
        note: `业务 session '${creatorSessionId}' 没有 worktree 改动可合入。`,
      });
    }
    return JSON.stringify({
      ok: true,
      kind: "diff",
      creatorSessionId,
      files: diff.files,
      note: "传 args={ message: \"...\" } 把整个 session 的 identity 改动合入 main。",
    });
  }

  const r = await evolveSelfMerge({ baseDir, objectId, creatorSessionId, message });
  if (!r.ok) {
    return `[evolve_self:${r.code}] ${r.message}`;
  }
  return JSON.stringify({
    ok: true,
    kind: r.merged ? "merged" : "pr-issue",
    commitSha: r.commitSha,
    files: r.files,
    ...(r.prIssueId !== undefined ? { prIssueId: r.prIssueId } : {}),
  });
}
