/**
 * root.evolve_self command —— super-flow 身份合入闸门（design §4 / P3）。
 *
 * 只在 super flow（sessionId="super"）里有意义：把「触发本 super 的业务 session
 * (creatorSessionId) 的 overlay 试验改动」正式合入 canonical main。
 *
 * 两种用法：
 * - 无 args / 无 message → **diff 模式**：列出 creator session overlay 改了哪些 stone 文件。
 * - args={ message, files? } → **合入模式**：从 main 建实验分支应用 overlay 文件、
 *   self-scope ff-merge 回 main，返回 commitSha（署名 = objectId，非 bootstrap）。
 *   失败（冲突 / git 错）→ 错误字符串，overlay 保留、main 不变。
 *
 * 与 metaprog 的分工：metaprog 是裸 worktree 协议（开/写/commit/merge 手动四步）；
 * evolve_self 是 overlay 模型下的「一键合入身份试验」——读 overlay → 应用 → 合 main，
 * 是 Object 身份从「session 试验」到「main 提交」的常规通道。
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
那个 session 的 overlay 试验层，session 内即时生效，但 main（canonical 权威自我）不变。

要把试验沉淀为正式身份，须在 **super flow** 里调 evolve_self，把触发本次 super 的
那个业务 session 的 overlay 改动合入 main（git commit + ff-merge，署名你自己）。

## 用法

- **看 diff**（无参）：\`open(command="evolve_self")\`
  → 列出 creator session overlay 改了哪些 stone 文件（你这次试验改了身份的哪些部分）。
- **合入**：\`open(command="evolve_self", args={ message: "为什么改", files?: ["self.md", ...] })\`
  - message 必填（commit 说明）。
  - files 缺省=overlay 下全部；传子集只合选定文件。
  - 成功返回 \`{ ok:true, commitSha, files }\`，main 已更新——下一轮新 session 见新身份。
  - 失败（冲突 / 无 overlay）返回错误字符串，overlay 保留、main 不变。

## 何时用

- caller 在业务 session 试改了自己的 self.md / executable，想"这次定型，永久生效"。
- 你在 super flow 审视后认可这些改动 → evolve_self 合入。
- 若 overlay 文件无需全合，用 files 选子集。
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

export const evolveSelfCommand: ObjectMethod = {
  paths: ["evolve_self"],
  schema: {
    args: {
      message: { type: "string", required: false, description: "合入 commit 说明（合入模式必填）" },
      files: { type: "array", required: false, description: "选定合入的文件（relWithinObject）；缺省全部" },
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
    return "[evolve_self] 拿不到触发本 super flow 的业务 session（thread.creatorSessionId 缺失）。evolve_self 需要由某个业务 session talk(target=\"super\") 触发，才能定位要合入的 overlay。";
  }

  const message = asString(ctx.args.message);
  const filesRaw = ctx.args.files;
  const files = filesRaw === undefined ? undefined : asStringArray(filesRaw);
  if (filesRaw !== undefined && !files) {
    return "[evolve_self] files 必须是字符串数组（relWithinObject 列表），如 [\"self.md\", \"executable/index.ts\"]。";
  }

  // 无 message → diff 模式（呈现 overlay 改了哪些文件）
  if (!message || !message.trim()) {
    const diff = await evolveSelfDiff(baseDir, objectId, creatorSessionId);
    if (diff.files.length === 0) {
      return JSON.stringify({
        ok: true,
        kind: "diff",
        files: [],
        note: `业务 session '${creatorSessionId}' 没有 overlay 改动可合入。`,
      });
    }
    return JSON.stringify({
      ok: true,
      kind: "diff",
      creatorSessionId,
      files: diff.files,
      note: "传 args={ message: \"...\", files?: [...] } 合入选定文件（缺省全部）。",
    });
  }

  // 合入模式
  const r = await evolveSelfMerge({ baseDir, objectId, creatorSessionId, message, files });
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
