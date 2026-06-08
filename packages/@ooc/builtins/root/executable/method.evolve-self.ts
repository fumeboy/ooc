/**
 * root.evolve_self command —— super-flow 身份合入闸门（design §4 / P3）。
 *
 * 只在 super flow（sessionId="super"）里有意义：把「触发本 super 的业务 session
 * (creatorSessionId) 的 worktree 试验改动」正式合入 canonical main。
 *
 * 两种用法：
 * - 无 args / 无 message → **diff 模式**：列出 creator session worktree 改了哪些 stone 文件。
 * - args={ message } → **合入模式**：commit creator session 的 `session-<sid>` worktree、
 *   rebase→self-scope ff-merge 回 main，返回 commitSha（署名 = objectId，非 bootstrap），
 *   并 GC（移除 worktree + 删分支）。失败（冲突 / git 错）→ 错误字符串，worktree 保留、main 不变。
 *
 * 与 metaprog 的分工：metaprog 是裸 worktree 协议（开/写/commit/merge 手动四步）；
 * evolve_self 是 worktree 模型下的「一键合入身份试验」——commit session worktree → 合 main，
 * 是 Object 身份从「session 试验」到「main 提交」的常规通道。**session 分支即演化单元**
 * （整个 session 的 identity 改动一并合入，不再支持挑文件子集）。
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
import type { MethodExecWindow } from "@ooc/core/executable/windows/method_exec/types.js";
import { buildGuidanceWindows } from "@ooc/builtins/_shared/executable/guidance.js";
import { emptyIntent } from "@ooc/builtins/_shared/executable/utils.js";

const EVOLVE_SELF_BASIC_PATH = "internal/executable/evolve_self/basic";

const KNOWLEDGE = `
evolve_self = **身份合入闸门**（仅 super flow 内可用）。

OOC 模型：你在普通业务 session 里对自己 self 文件（self.md / readable.* /
executable/** / visible/** / knowledge/**）的改动**不会即时改 main**——它们落在
那个 session 的 worktree（\`stones/session-<sid>/objects/<self>/\`，main 的完整副本），
session 内即时生效，但 main（canonical 权威自我）不变。

要把试验沉淀为正式身份，须在 **super flow** 里调 evolve_self，把触发本次 super 的
那个业务 session 的 worktree 改动合入 main（commit session 分支 + ff-merge，署名你自己）。
**session 分支即演化单元**：整个 session 的 identity 改动一并合入。

## 用法

- **看 diff**（无参）：\`open(method="evolve_self")\`
  → 列出 creator session worktree 改了哪些 stone 文件（你这次试验改了身份的哪些部分）。
- **合入**：\`open(method="evolve_self", args={ message: "为什么改" })\`
  - message 必填（commit 说明）。
  - 成功返回 \`{ ok:true, commitSha, files }\`，main 已更新——下一轮新 session 见新身份；
    worktree 已 GC（移除目录 + 删分支）。
  - 失败（冲突 / 无改动）返回错误字符串，worktree 保留、main 不变。

## 何时用

- caller 在业务 session 试改了自己的 self.md / executable，想"这次定型，永久生效"。
- 你在 super flow 审视后认可这些改动 → evolve_self 合入。
`.trim();

function asString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function asStringArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: string[] = [];
  for (const item of v) {
    if (typeof item !== "string") return undefined;
    out.push(item);
  }
  return out;
}

export const evolveSelfMethod: ObjectMethod = {
  paths: ["evolve_self"],
  schema: {
    args: {
      message: { type: "string", required: false, description: "合入 commit 说明（合入模式必填）" },
    },
  },
  intent: emptyIntent,
  onFormChange(change, { form }) {
    if (change.kind === "status_changed" && change.to !== "open") return [];
    return buildGuidanceWindows(form as MethodExecWindow, { [EVOLVE_SELF_BASIC_PATH]: KNOWLEDGE });
  },
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
    return "[evolve_self] 拿不到触发本 super flow 的业务 session（thread.creatorSessionId 缺失）。evolve_self 需要由某个业务 session talk(target=\"super\") 触发，才能定位要合入的 session worktree。";
  }

  const message = asString(ctx.args.message);

  // 无 message → diff 模式（呈现 worktree 改了哪些文件）
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

  // 合入模式
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
