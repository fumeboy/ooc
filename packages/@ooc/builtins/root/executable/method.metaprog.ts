/**
 * root.metaprog command —— 元编程协议入口集合（U6）。
 *
 * 单一命令名 `metaprog`，通过 `action` 参数分发。把 stone-versioning 的高层
 * 编排（openMetaprogWorktree / commitWorktree / tryMergeSelf / requestPrIssueReview /
 * resolvePrIssue / rollback）映射到 LLM 可调的 root.* 命令；不对外暴露 raw git。
 *
 * 设计动机（详见 docs/plans/2026-05-20-001-feat-stones-git-versioning-plan.md U6）：
 * - 一条命令多 action 比 N 条平级命令更紧凑——LLM 学一个 metaprog 协议即可
 * - 入口由 reflectable knowledge（U7）讲解；本文件只做参数校验 + 调编排
 * - rollback / resolve 仅 Supervisor 可调（caller objectId 校验）
 *
 * 不做的事：
 * - 不在本文件实现编辑逻辑——LLM 直接 fs 写到 worktree 路径（write_file 已自动
 *   按 stonesBranch 路由）
 * - 不主动启动 worktree 子 OOC Server——由 reflectable knowledge 教 LLM shell 出
 */

import type {
  MethodExecutionContext,
  ObjectMethod,
} from "@ooc/core/extendable/_shared/method-types.js";
import {
  commitWorktree,
  openMetaprogWorktree,
  requestPrIssueReview,
  resolvePrIssue,
  rollback,
  supervisorCreateObject,
  tryMergeSelf,
  SUPERVISOR_OBJECT_ID,
  type MetaprogWorktreeRef,
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
metaprog = **元编程协议**。Object 在 super flow 中安全地修改自己的 stone（self.md /
executable / knowledge）通过这个命令族协调，错了能回退、合并需评审。

## actions

- \`open_worktree\` — 开 git worktree 沙箱
  - args: 无（branch token 自动生成）
  - 返回：{ branch, path }；后续编辑请直接写 path 下的文件
- \`commit\` — stage + 提交 worktree 当前变更
  - args: { branch: <从 open_worktree 拿到的>, intent: "..." }
  - 自动以你的 objectId 署名
- \`merge\` — 请求把 worktree branch 合到 main
  - args: { branch }
  - 结果四种：
    - merged（成功 ff 合并到 main，worktree 已清理）
    - must-pr-issue（diff 越出自治区，自动开了 PR-Issue 给 supervisor，issueId 在返回值里）
    - rebase-conflict（rebase main 时冲突；你需要回到 worktree 解决，或重新开 worktree）
    - non-fast-forward（base 又飘了；重新 merge 一次即可）
- \`resolve\` — 仅 supervisor 可调；标 PR-Issue 决议
  - args: { issueId: <PR Issue id>, decision: "merge" | "reject" | "request-changes" }
- \`rollback\` — 仅 supervisor 可调；把某个 Object 的 stone 回滚到先前 commit
  - args: { objectId: "...", targetCommit: "<sha>" }
  - 结果：新 commit 由 supervisor 署名（R4 例外）
- \`create_object\` — 仅 supervisor 可调；为新 Object 原子地落盘 stone 骨架 + commit on main
  - args: { objectId: "<newId>", selfMd: "...", readableMd: "...", knowledge?: { "<file>.md": "..." }, intent?: "..." }
  - 等价于"open_worktree → write → commit → merge（cross-scope→PR-Issue→supervisor 自审 merge）"的快捷路径——避免新 Object 创建产生自审 PR-Issue 噪音
  - 失败返回字符串带结构化 token：\`[metaprog:create_object:<CODE>] <msg>\`
    - CODE ∈ { FORBIDDEN（非 supervisor caller）/ INVALID_INPUT（参数错）/ ALREADY_EXISTS（stone 已存在）/ GIT:<gitCode> }
    - LLM 可 substring 匹配 CODE 做分支决策
  - 成功返回 JSON：{ ok: true, objectId, commitSha }——文件已在 main 上 committed

## 推荐流程（Object 自治区改自己）

1. \`open(method="metaprog", args={action:"open_worktree"})\` → 拿到 branch / path
2. 直接 \`write_file(path="stones/<self>/<...>", content="...")\`（write_file 会
   按当前 server 绑定的 stones-branch 自动路由到 worktree）
3. **建议**：shell 启动一个独立 OOC Server 指向 worktree 做试运行验证
   \`bun run packages/@ooc/core/app/server/index.ts --world ./.ooc-world --stones-branch <branch> --port 0\`
4. \`open(method="metaprog", args={action:"commit", branch, intent:"..."})\`
5. \`open(method="metaprog", args={action:"merge", branch})\`
6. 若 must-pr-issue：等 supervisor 在 super flow 里 \`resolve\`

## 仅 supervisor 用

- 看到 \`[recovery-needed]\` 类 PR-Issue 时调 \`rollback\`
- 评审跨自治区 PR-Issue 时调 \`resolve\`
`.trim();

type MetaprogAction = "open_worktree" | "commit" | "merge" | "resolve" | "rollback" | "create_object";


function asString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function asStringMap(v: unknown): Record<string, string> | undefined {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val !== "string") return undefined;
    out[k] = val;
  }
  return out;
}

export const metaprogMethod: ObjectMethod = {
  paths: ["metaprog"],
  schema: {
    args: {
      action: {
        type: "string",
        required: true,
        description: "元编程动作",
        enum: ["open_worktree", "commit", "merge", "resolve", "rollback", "create_object"],
      },
      branch: { type: "string", required: false, description: "从 open_worktree 拿到的 branch 名" },
      intent: { type: "string", required: false, description: "commit 意图说明" },
      issueId: { type: "number", required: false, description: "PR Issue id（resolve 用）" },
      decision: {
        type: "string",
        required: false,
        description: "resolve 决议",
        enum: ["merge", "reject", "request-changes"],
      },
      objectId: { type: "string", required: false, description: "目标 objectId（rollback / create_object 用）" },
      targetCommit: { type: "string", required: false, description: "回滚目标 commit sha（rollback 用）" },
      selfMd: { type: "string", required: false, description: "新 object 的 self.md 内容（create_object 用）" },
      readableMd: { type: "string", required: false, description: "新 object 的 readable.md 内容（create_object 用）" },
      readmeMd: { type: "string", required: false, description: "readableMd 的向后兼容别名" },
      knowledge: { type: "object", required: false, description: "{ filename: content } 的 string map" },
    },
  } as MethodCallSchema,
  // Q0d: metaprog 是元编程入口 (open_worktree / commit / merge / resolve / rollback / create_object),
  // 全部触发 stones git 副作用 (修改 stones/<self>/ 下的 self.md / server / knowledge);
  // 等价 design §3 中的 "super flow 改 self.md / readme.md" + "delete_* 任何删除类"。
  intent: emptyIntent,
  onFormChange(change, { form, intents }) {
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
        "请用 refine(form_id, args={ action: 'open_worktree' | 'commit' | 'merge' | 'resolve' | 'rollback' | 'create_object', ... }) 补齐后 submit(form_id)。\n" +
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
    case "open_worktree": {
      const r = await openMetaprogWorktree({ baseDir, objectId: callerId });
      if (!r.ok) {
        if (r.code === "INVALID_INPUT") return `[metaprog] open_worktree 失败：${r.message}`;
        return `[metaprog] open_worktree git 失败 (${r.gitCode})：${r.stderr}`;
      }
      return JSON.stringify({
        ok: true,
        branch: r.worktree.branch,
        path: r.worktree.path,
        baseCommit: r.worktree.baseCommit,
      });
    }

    case "commit": {
      const wt = parseWorktreeRef(ctx.args, baseDir, callerId);
      if (typeof wt === "string") return wt;
      const intent = asString(ctx.args.intent);
      if (!intent || !intent.trim()) return "[metaprog] commit 需要 intent。";
      const r = await commitWorktree({ worktree: wt, intent, authorObjectId: callerId });
      if (!r.ok) {
        if (r.code === "INVALID_INPUT") return `[metaprog] commit 失败：${r.message}`;
        return `[metaprog] commit git 失败 (${r.gitCode})：${r.stderr}`;
      }
      return JSON.stringify({ ok: true, commitSha: r.commitSha });
    }

    case "merge": {
      const wt = parseWorktreeRef(ctx.args, baseDir, callerId);
      if (typeof wt === "string") return wt;
      const r = await tryMergeSelf(wt, callerId);
      if (!r.ok) {
        if (r.code === "INVALID_INPUT") return `[metaprog] merge 失败：${r.message}`;
        return `[metaprog] merge git 失败 (${r.gitCode})：${r.stderr}`;
      }
      if (r.kind === "must-pr-issue") {
        // 自动开 PR-Issue 让 supervisor 评审
        const pr = await requestPrIssueReview({
          worktree: wt,
          intent: asString(ctx.args.intent) ?? `merge request from ${callerId}`,
          authorObjectId: callerId,
        });
        if (!pr.ok) {
          if (pr.code === "INVALID_INPUT") return `[metaprog] PR-Issue 创建失败：${pr.message}`;
          if (pr.code === "ISSUE_SERVICE")
            return `[metaprog] PR-Issue 创建失败：${pr.message}`;
          return `[metaprog] PR-Issue git 失败 (${pr.gitCode})：${pr.stderr}`;
        }
        return JSON.stringify({ ok: true, kind: "must-pr-issue", paths: r.paths, issueId: pr.issueId });
      }
      return JSON.stringify({ ok: true, kind: r.kind, ...(r.kind === "merged" ? { commitSha: r.commitSha } : {}) });
    }

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

    case "create_object": {
      // 错误返回带 `[metaprog:create_object:<CODE>] <message>` 结构化 token，
      // LLM caller 可 substring 匹配 CODE 做分支决策（R10 H-1）。
      if (callerId !== SUPERVISOR_OBJECT_ID) {
        return `[metaprog:create_object:FORBIDDEN] 仅 supervisor 可调（你是 ${callerId}）。`;
      }
      const newObjectId = asString(ctx.args.objectId);
      const selfMd = asString(ctx.args.selfMd);
      // readableMd is primary; readmeMd accepted as backward-compat alias
      const readableMd = asString(ctx.args.readableMd) ?? asString(ctx.args.readmeMd);
      const intent = asString(ctx.args.intent);
      if (!newObjectId) return "[metaprog:create_object:INVALID_INPUT] 需要 objectId。";
      if (!selfMd || !selfMd.trim()) return "[metaprog:create_object:INVALID_INPUT] 需要 selfMd（非空字符串）。";
      if (!readableMd || !readableMd.trim()) return "[metaprog:create_object:INVALID_INPUT] 需要 readableMd（非空字符串）。";
      let knowledge: Record<string, string> | undefined;
      if (ctx.args.knowledge !== undefined) {
        knowledge = asStringMap(ctx.args.knowledge);
        if (!knowledge) {
          return "[metaprog:create_object:INVALID_INPUT] knowledge 必须是 { filename: content } 的 string map。";
        }
      }
      const r = await supervisorCreateObject({
        baseDir,
        newObjectId,
        selfMd,
        readableMd,
        knowledge,
        intent,
      });
      if (!r.ok) {
        if (r.code === "INVALID_INPUT") return `[metaprog:create_object:INVALID_INPUT] ${r.message}`;
        if (r.code === "ALREADY_EXISTS") return `[metaprog:create_object:ALREADY_EXISTS] ${r.message}`;
        if (r.code === "GIT") return `[metaprog:create_object:GIT:${r.gitCode}] ${r.stderr}`;
        return `[metaprog:create_object:${r.code}] ${r.message}`;
      }
      return JSON.stringify({ ok: true, objectId: newObjectId, commitSha: r.commitSha });
    }

    default:
      return `[metaprog] 未知 action '${action}'。`;
  }
}

/** 把命令 args 中的 branch（commit / merge action 必填）补回完整 MetaprogWorktreeRef。 */
function parseWorktreeRef(
  args: Record<string, unknown>,
  baseDir: string,
  callerId: string,
): MetaprogWorktreeRef | string {
  const branch = asString(args.branch);
  if (!branch) return "[metaprog] commit/merge 需要 branch（从 open_worktree 拿）。";
  if (!branch.startsWith(`metaprog/${callerId}/`)) {
    return `[metaprog] branch '${branch}' 不属于 caller '${callerId}' 的元编程命名空间。`;
  }
  return {
    baseDir,
    objectId: callerId,
    branch,
    path: `${baseDir}/stones/${branch}`,
    baseCommit: "",
  };
}
