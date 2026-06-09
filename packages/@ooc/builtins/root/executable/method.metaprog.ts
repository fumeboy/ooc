/**
 * root.metaprog method —— 治理协议入口（PR-Issue 评审 + 回滚）。
 *
 * 单一命令名 `metaprog`，通过 `action` 参数分发，现仅保留两个**治理** action：
 * `resolve`（标 PR-Issue 决议）/ `rollback`（回滚某 Object 的 stone 到先前 commit）。
 * 二者均只 supervisor 可调，映射到 stone-versioning 的 resolvePrIssue / rollback。
 *
 * 改自己 / 建别人 / 改别人的写不再走本命令——直接 write_file/edit 写文件落 session
 * worktree，经 super flow（evolve_self）统一判断合入 main（self-scope ff-merge /
 * cross-scope PR-Issue → supervisor resolve）。详见
 * docs/2026-06-09-remove-metaprog-unify-session-worktree-design.md。
 */

import type {
  MethodExecutionContext,
  ObjectMethod,
} from "@ooc/core/extendable/_shared/method-types.js";
import {
  resolvePrIssue,
  rollback,
  SUPERVISOR_OBJECT_ID,
  type PrIssueDecision,
} from "@ooc/core/persistable/index.js";
import type { Intent, MethodCallSchema } from "@ooc/core/thinkable/context/intent.js";
import type { ContextWindow } from "@ooc/core/executable/windows/_shared/types.js";
import type { MethodExecWindow } from "@ooc/core/executable/windows/method_exec/types.js";
import { buildGuidanceWindows } from "@ooc/builtins/_shared/executable/guidance.js";
import { emptyIntent } from "@ooc/builtins/_shared/executable/utils.js";

const METAPROG_BASIC_PATH = "internal/executable/metaprog/basic";
const METAPROG_INPUT_PATH = "internal/executable/metaprog/input";

const KNOWLEDGE = `
metaprog = **治理协议**（PR-Issue 评审 + 回滚），仅 supervisor 可调。

## 写自己 / 改别人 / 建新对象怎么做（不经本命令）

直接写文件即可——不需要任何 worktree 命令：

1. 改**已存在**对象的文件：\`write_file(path="stones/<self>/self.md", content="...")\` 改自己；
   \`write_file(path="stones/<otherId>/self.md", content="...")\` 改别人。
2. 建一个**全新**对象：用 \`create_object\`（原子建骨架；**不能**裸 write_file——
   新对象还没 package.json 会被拒）：
   \`open(method="create_object", args={ objectId:"<newId>", selfMd:"...", readableMd:"...", knowledge?:{...} })\`
3. 写落到**本 session 的 worktree**（main 未变），本 session 内即时生效。
4. 去 super flow 调 \`evolve_self\` 把改动合入 main：
   - 只改了自己（self-scope）→ 直接 ff-merge 到 main。
   - 动了别人 / 建了新对象（cross-scope）→ 自动开 PR-Issue，等 supervisor \`resolve\`。

## actions（治理，仅 supervisor）

- \`resolve\` — 标 PR-Issue 决议
  - args: { issueId: <PR Issue id>, decision: "merge" | "reject" | "request-changes" }
- \`rollback\` — 把某个 Object 的 stone 回滚到先前 commit
  - args: { objectId: "...", targetCommit: "<sha>" }
  - 结果：新 commit 由 supervisor 署名
  - 看到 \`[recovery-needed]\` 类 PR-Issue 时用它
`.trim();

type MetaprogAction = "resolve" | "rollback";

function asString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

export const metaprogMethod: ObjectMethod = {
  paths: ["metaprog"],
  schema: {
    args: {
      action: {
        type: "string",
        required: true,
        description: "治理动作",
        enum: ["resolve", "rollback"],
      },
      issueId: { type: "number", required: false, description: "PR Issue id（resolve 用）" },
      decision: {
        type: "string",
        required: false,
        description: "resolve 决议",
        enum: ["merge", "reject", "request-changes"],
      },
      objectId: { type: "string", required: false, description: "目标 objectId（rollback 用）" },
      targetCommit: { type: "string", required: false, description: "回滚目标 commit sha（rollback 用）" },
    },
  } as MethodCallSchema,
  // metaprog 现仅含治理 action（resolve / rollback），触发 stones git 副作用
  // （合入 / 回滚 main）；改自己/建别人的写已挪到 write_file → session worktree → super flow。
  intent: emptyIntent,
  onFormChange(change, { form }) {
    if (change.kind === "status_changed" && change.to !== "open") return [];
    // batch C narrowing(N1): onFormChange 的 form 在契约层是 base，narrow 回 MethodExecWindow 取 accumulatedArgs（runtime 保证此 form 即 method_exec form）。
    const args = change.kind === "args_refined" ? change.args : (form as MethodExecWindow).accumulatedArgs;
    const formStatus = form.status;
    const entries: Record<string, string> = { [METAPROG_BASIC_PATH]: KNOWLEDGE };
    if (formStatus !== "open") return buildGuidanceWindows(form, entries);
    const action = asString(args.action) as MetaprogAction | undefined;
    if (!action) {
      entries[METAPROG_INPUT_PATH] =
        "metaprog 还缺以下参数: action。\n" +
        "请用 refine(form_id, args={ action: 'resolve' | 'rollback', ... }) 补齐后 submit(form_id)。\n" +
        "不要 close 重 open——form 当前在 open 状态, refine 是正确路径。";
    }
    return buildGuidanceWindows(form, entries);
  },
  exec: (ctx) => executeMetaprog(ctx),
};

export async function executeMetaprog(ctx: MethodExecutionContext): Promise<string | undefined> {
  const thread = ctx.thread;
  if (!thread) return "[metaprog] 缺少 thread context。";
  if (!thread.persistence) return "[metaprog] thread 无 persistence。";
  const baseDir = thread.persistence.baseDir;
  const callerId = thread.persistence.objectId;

  const action = asString(ctx.args.action) as MetaprogAction | undefined;
  if (!action) return "[metaprog] 缺少 action 参数。";

  switch (action) {
    case "resolve": {
      if (callerId !== SUPERVISOR_OBJECT_ID) {
        return `[metaprog] resolve 仅 supervisor 可调（你是 ${callerId}）。`;
      }
      const issueId = Number(ctx.args.issueId);
      if (!Number.isInteger(issueId) || issueId < 1) return "[metaprog] resolve 需要正整数 issueId。";
      const decisionRaw = asString(ctx.args.decision);
      const allowed: PrIssueDecision[] = ["merge", "reject", "request-changes"];
      if (!allowed.includes(decisionRaw as PrIssueDecision)) {
        return `[metaprog] resolve 的 decision 必须是 ${allowed.join(" / ")}.`;
      }
      const r = await resolvePrIssue({ baseDir, issueId, decision: decisionRaw as PrIssueDecision });
      if (!r.ok) {
        if (r.code === "NOT_FOUND" || r.code === "INVALID_STATE") return `[metaprog] resolve 失败：${r.message}`;
        if (r.code === "ISSUE_SERVICE") return `[metaprog] resolve 失败：${r.message}`;
        return `[metaprog] resolve git 失败 (${r.gitCode})：${r.stderr}`;
      }
      return JSON.stringify({ ok: true, kind: r.kind, ...("commitSha" in r ? { commitSha: r.commitSha } : {}), ...("archivedRef" in r ? { archivedRef: r.archivedRef } : {}) });
    }

    case "rollback": {
      if (callerId !== SUPERVISOR_OBJECT_ID) {
        return `[metaprog] rollback 仅 supervisor 可调（你是 ${callerId}）。`;
      }
      const objectId = asString(ctx.args.objectId);
      const targetCommit = asString(ctx.args.targetCommit);
      if (!objectId) return "[metaprog] rollback 需要 objectId。";
      if (!targetCommit) return "[metaprog] rollback 需要 targetCommit。";
      const r = await rollback({ baseDir, objectId, targetCommit, supervisorAuthor: callerId });
      if (!r.ok) {
        if (r.code === "INVALID_INPUT") return `[metaprog] rollback 失败：${r.message}`;
        if (r.code === "FORBIDDEN") return `[metaprog] rollback 禁止：${r.message}`;
        return `[metaprog] rollback git 失败 (${r.gitCode})：${r.stderr}`;
      }
      return JSON.stringify({ ok: true, commitSha: r.commitSha });
    }

    default:
      return `[metaprog] 未知 action '${action}'。`;
  }
}
