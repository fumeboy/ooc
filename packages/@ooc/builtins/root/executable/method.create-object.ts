/**
 * root.create_object method —— 在业务 session 里建**新对象骨架**（落 session worktree）。
 *
 * 背景（2026-06-09）：去 metaprog 后建对象原语断了——write_file 只能改已存在对象的文件
 * （靠 package.json 判 owner 边界，新对象没 package.json → 被判 workspace-level 资源拒写）。
 * create_object 补回这条原语：原子建 package.json + self.md + readable.md [+ knowledge/]
 * 到 `flows/<sid>/objects/<newId>/`，**不 commit**——end → super flow evolve_self 合入。
 *
 * 谁能调：**仅 business session**（thread.persistence.sessionId 非 super、非空）。
 * - super flow 是合入闸门（evolve_self），不直接建对象身体。
 * - 控制面建对象走 HTTP `POST /api/stones`（直 commit main），不经 LLM method。
 *
 * 合入语义：newObjectId ≠ author 的自治区 → evolve_self 时 cross-scope →
 * 自动开 PR-Issue 给 supervisor resolve（supervisor 自审是合法治理）。
 */

import type {
  MethodExecutionContext,
  ObjectMethod,
} from "@ooc/core/extendable/_shared/method-types.js";
import { createObjectInSession } from "@ooc/core/persistable/index.js";
import { isSuperSessionId } from "@ooc/core/_shared/types/constants.js";
import type { MethodCallSchema } from "@ooc/core/thinkable/context/intent.js";
import type { MethodExecWindow } from "@ooc/core/executable/windows/method_exec/types.js";
import { buildGuidanceWindows } from "@ooc/builtins/_shared/executable/guidance.js";
import { emptyIntent } from "@ooc/builtins/_shared/executable/utils.js";

const CREATE_OBJECT_BASIC_PATH = "internal/executable/create_object/basic";
const CREATE_OBJECT_INPUT_PATH = "internal/executable/create_object/input";

const KNOWLEDGE = `
create_object = **建一个全新对象的骨架**（仅业务 session 可调）。

## 何时用 create_object（而不是 write_file）

- **建一个还不存在的对象** → 用 create_object。它原子地落
  \`objects/<newId>/{package.json, self.md, readable.md[, knowledge/*]}\`，
  让新对象有合法的 object 边界（package.json）。
- **改一个已存在对象的文件**（自己或别人的 self.md / executable / …）→ 用 write_file / edit。
  write_file 靠 package.json 判 owner 边界，建新对象时新对象还没 package.json，会被拒——
  所以建对象**必须**走 create_object，不能裸 write_file。

## 参数

- objectId: 必填，新对象 id（≤64 字符、逐段 [A-Za-z0-9_.-]；嵌套子对象用 \`parent/child\`）。
  不能与现有对象或 Builtin（supervisor/user/root 等）冲突。
- selfMd: 必填，新对象的 self.md 全文（第一人称身份叙述，非空）。
- readableMd: 必填，新对象的 readable.md 全文（对外公开自述，非空）。
- knowledge: 可选，\`{ "<filename>.md": "<content>" }\` map，写入 knowledge/ 目录（seed 知识）。

## 落点与合入

- 骨架落**本 session 的 worktree**（\`flows/<sid>/objects/<newId>/\`），**main（canonical）此刻不变**。
- 要让新对象永久存在：本 session \`end\` → 进 super flow → \`evolve_self\`。
  建新对象 ≠ 你自己（cross-scope）→ evolve_self 自动开 PR-Issue 给 supervisor \`resolve\` 合入 main。

## 调用示例

\`\`\`
open(method="create_object", title="建 sentry_factor_dev 对象", args={
  objectId: "sentry_factor_dev",
  selfMd: "# 我是 sentry_factor_dev\\n...",
  readableMd: "# sentry_factor_dev\\n哨兵平台因子开发助手...",
  knowledge: { "psm-query.md": "# psm 查询...\\n..." }
})
\`\`\`
`.trim();

function asString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function asKnowledge(v: unknown): Record<string, string> | undefined {
  if (v == null) return undefined;
  if (typeof v !== "object" || Array.isArray(v)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val !== "string") return undefined;
    out[k] = val;
  }
  return out;
}

export const createObjectMethod: ObjectMethod = {
  paths: ["create_object"],
  schema: {
    args: {
      objectId: { type: "string", required: true, description: "新对象 id（≤64 字符、逐段 [A-Za-z0-9_.-]）" },
      selfMd: { type: "string", required: true, description: "新对象 self.md 全文（非空）" },
      readableMd: { type: "string", required: true, description: "新对象 readable.md 全文（非空）" },
      knowledge: { type: "object", required: false, description: "可选 seed knowledge：{ filename → content }" },
    },
  } as MethodCallSchema,
  intent: emptyIntent,
  onFormChange(change, { form }) {
    if (change.kind === "status_changed" && change.to !== "open") return [];
    const args = change.kind === "args_refined" ? change.args : (form as MethodExecWindow).accumulatedArgs;
    const entries: Record<string, string> = { [CREATE_OBJECT_BASIC_PATH]: KNOWLEDGE };
    if (form.status !== "open") return buildGuidanceWindows(form as MethodExecWindow, entries);
    const missing: string[] = [];
    if (!asString(args.objectId)) missing.push("objectId");
    if (!asString(args.selfMd)) missing.push("selfMd");
    if (!asString(args.readableMd)) missing.push("readableMd");
    if (missing.length > 0) {
      entries[CREATE_OBJECT_INPUT_PATH] =
        `create_object 还缺以下参数: ${missing.join(", ")}。\n` +
        "请用 refine(form_id, args={ objectId, selfMd, readableMd, knowledge? }) 补齐后 submit(form_id)。";
    }
    return buildGuidanceWindows(form as MethodExecWindow, entries);
  },
  exec: (ctx) => executeCreateObject(ctx),
};

export async function executeCreateObject(ctx: MethodExecutionContext): Promise<string | undefined> {
  const thread = ctx.thread;
  if (!thread) return "[create_object] 缺少 thread context。";
  if (!thread.persistence) return "[create_object] thread 无 persistence。";

  const { baseDir, sessionId, objectId: authorObjectId } = thread.persistence;

  // 仅 business session 可调：super flow 是合入闸门不建对象；控制面建对象走 HTTP。
  if (isSuperSessionId(sessionId) || !sessionId || !sessionId.trim()) {
    return (
      "[create_object] 仅业务 session 可建对象（当前 session=" +
      `'${sessionId ?? ""}'）。super flow 是合入闸门（evolve_self），不直接建对象；` +
      "控制面建对象走 HTTP POST /api/stones。请在业务 thread 里调 create_object，" +
      "再 end → super flow evolve_self 合入 main。"
    );
  }

  const newObjectId = asString(ctx.args.objectId);
  if (!newObjectId) return "[create_object] 缺少 objectId 参数。";
  const selfMd = asString(ctx.args.selfMd);
  if (selfMd === undefined) return "[create_object] 缺少 selfMd 参数。";
  const readableMd = asString(ctx.args.readableMd);
  if (readableMd === undefined) return "[create_object] 缺少 readableMd 参数。";
  const knowledgeRaw = ctx.args.knowledge;
  const knowledge = asKnowledge(knowledgeRaw);
  if (knowledgeRaw != null && knowledge === undefined) {
    return "[create_object] knowledge 必须是 { filename → string content } 形态。";
  }

  const r = await createObjectInSession({
    baseDir,
    sessionId,
    authorObjectId,
    newObjectId,
    selfMd,
    readableMd,
    ...(knowledge ? { knowledge } : {}),
  });

  if (!r.ok) {
    return `[create_object:${r.code}] ${r.message}`;
  }

  return JSON.stringify({
    ok: true,
    objectId: r.objectId,
    note: "已落 session worktree，end→super flow evolve_self 合入 main（cross-scope→你自审 resolve）才永久。",
  });
}
