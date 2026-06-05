/**
 * root.open_knowledge command — 委托到 knowledge_window constructor。
 *
 * 2026-06-02 P6.§4-§5: 历史 root.open_knowledge 的构造逻辑（path 校验 + KnowledgeWindow build）
 * 已迁到 packages/@ooc/builtins/knowledge/executable/index.ts 的 kind="constructor" knowledge method。
 * 这里保留 root method 表项（knowledge / paths）；exec 走 lookupConstructor("knowledge") 委托。
 */

import type { ObjectMethod } from "@ooc/core/extendable/_shared/method-types.js";
import { makeRootDelegator } from "@ooc/builtins/_shared/executable/delegator.js";
import type { Intent, MethodCallSchema } from "@ooc/core/thinkable/context/intent.js";
import type { ContextWindow } from "@ooc/core/executable/windows/_shared/types.js";
import type { MethodExecWindow } from "@ooc/core/executable/windows/method_exec/types.js";
import { buildGuidanceWindows } from "@ooc/builtins/_shared/executable/guidance.js";
import { emptyIntent } from "@ooc/builtins/_shared/executable/utils.js";

// 2026-06-02 P6.§4-§5: side-effect import 触发 knowledge_window constructor 注册
import "@ooc/builtins/knowledge";

const OPEN_KNOWLEDGE_BASIC_PATH = "internal/executable/open_knowledge/basic";
const OPEN_KNOWLEDGE_INPUT_PATH = "internal/executable/open_knowledge/input";

const KNOWLEDGE = `
open_knowledge 用于显式打开一个 knowledge doc，作为 knowledge_window 持续可见。

参数：
- path: 必填，knowledge 索引中的路径（不带 .md，例如 "build-tools/file-ops"）

打开后该 knowledge 会强制以 full 形式渲染（绕过 activator 的 command-path 命中规则），
直到显式 close。等价于旧 pinnedKnowledge。

后续：
- 关闭：close(window_id="<knowledge_window_id>")

调用示例：
open(command="open_knowledge", title="pin file-ops", args={ path: "build-tools/file-ops" })
`.trim();


export const openKnowledgeCommand: ObjectMethod = {
  paths: ["open_knowledge"],
  schema: {
    args: {
      path: { type: "string", required: true, description: "knowledge 索引中的路径（不带 .md）" },
    },
  } as MethodCallSchema,
  intent: emptyIntent,
  onFormChange(change, { form, intents }) {
    if (change.kind === "status_changed" && change.to !== "open") return [];
    const args = change.kind === "args_refined" ? change.args : form.accumulatedArgs;
    const formStatus = form.status;
    const entries: Record<string, string> = { [OPEN_KNOWLEDGE_BASIC_PATH]: KNOWLEDGE };
    if (formStatus !== "open") return buildGuidanceWindows(form, entries);
    const path = typeof args.path === "string" ? args.path : "";
    if (!path) {
      entries[OPEN_KNOWLEDGE_INPUT_PATH] =
        "open_knowledge 还缺以下参数: path。\n" +
        "请用 refine(form_id, args={ path: \"<knowledge-doc-path-不带.md>\" }) 补齐后 submit(form_id)。\n" +
        "不要 close 重 open——form 当前在 open 状态, refine 是正确路径。";
    }
    return buildGuidanceWindows(form, entries);
  },
  exec: (ctx) => executeOpenKnowledgeCommand(ctx),
};

/**
 * P6.§4-§5 thin delegator —— 委托到 knowledge_window constructor。
 */
export const executeOpenKnowledgeCommand = makeRootDelegator({
  command: "open_knowledge",
  constructorKind: "knowledge",
  objectLabel: "knowledge_window",
});
