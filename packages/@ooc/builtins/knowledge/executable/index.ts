/**
 * knowledge_object — 一段 knowledge 文本作为 Object 出现在 context 中。
 *
 * 2026-05-28 ooc-6 Object Unification: 从 builtin window 迁移为 builtin object，
 * 放置在 packages/@ooc/builtins/knowledge/。
 *
 * 三种 source：
 * - explicit  ：LLM 显式 \`open(method="open_knowledge")\` 创建；持久化；可 close
 * - protocol  ：每轮自动注入的协议常量（KNOWLEDGE）+ 各 method_exec form 的 knowledge() 派生
 * - activator ：stones/{id}/knowledge/*.md 经 intentPaths 命中合成；带 presentation
 *
 * 后两种由 src/executable/index.ts: synthesizeKnowledgeWindows 在 buildInputItems 阶段
 * 合成到 thread.contextWindows 的副本上，不会持久化。
 *
 * 注册的 method：reload / close / set_viewport
 * - reload：强制下一轮重新激活；loader 已按 mtime 失效缓存，主要是语义提示
 * - close：仅 explicit 来源可关闭；protocol / activator 由 onClose hook 拒绝
 */

import type {
  ObjectMethod,
} from "@ooc/core/extendable/_shared/method-types.js";
import { builtinRegistry } from "@ooc/core/extendable/_shared/registry.js";
import {
  DEFAULT_VIEWPORT,
} from "@ooc/core/extendable/_shared/viewport.js";
import {
  ROOT_WINDOW_ID,
  generateWindowId,
  type KnowledgeWindow,
} from "@ooc/core/extendable/_shared/types.js";
import { deriveStoneFromThread } from "@ooc/core/persistable/common.js";
import { derivePoolFromThread } from "@ooc/core/persistable/pool-object.js";
import { loadKnowledgeIndex } from "@ooc/core/thinkable/knowledge/index.js";
// readable 维度由 barrel index.ts 的 import "./readable.js" 加载（executable 不 import readable）。

import type { MethodExecWindow } from "@ooc/core/executable/windows/method_exec/types.js";
import { buildGuidanceWindows } from "@ooc/builtins/_shared/executable/guidance.js";
import { basenameOfPath, emptyIntent } from "@ooc/builtins/_shared/executable/utils.js";


const KNOWLEDGE_WINDOW_RELOAD_BASIC = "internal/windows/knowledge/reload/basic";
const KNOWLEDGE_WINDOW_CLOSE_BASIC = "internal/windows/knowledge/close/basic";

const RELOAD_KNOWLEDGE = `
knowledge_object.reload 强制下一轮重新计算激活集合。当前 loader 已按 mtime 自动失效缓存，
本命令主要是语义提示。
`.trim();

const CLOSE_KNOWLEDGE = `
knowledge_object.close 释放 window；不影响 knowledge 文件本身。

注意：source=protocol / source=activator 的 knowledge_object 是系统每轮自动合成的，
不存在于 thread.contextWindows 持久状态——LLM 也无法 close 它们（hook 会拒绝）。
仅 source=explicit（来自 open_knowledge）的 window 可被 close。
`.trim();

const reloadMethod: ObjectMethod = {
  paths: ["reload"],
  intent: emptyIntent,
  onFormChange: (change, { form }) => {
    if (change.kind === "status_changed" && change.to !== "open") return [];
    return buildGuidanceWindows(form, { [KNOWLEDGE_WINDOW_RELOAD_BASIC]: RELOAD_KNOWLEDGE });
  },
  exec: () => undefined,
};

const closeMethod: ObjectMethod = {
  paths: ["close"],
  intent: emptyIntent,
  onFormChange: (change, { form }) => {
    if (change.kind === "status_changed" && change.to !== "open") return [];
    return buildGuidanceWindows(form, { [KNOWLEDGE_WINDOW_CLOSE_BASIC]: CLOSE_KNOWLEDGE });
  },
  exec: () => undefined,
};

/** knowledge_object 的 readable 维度（readable + window method set_viewport + onClose）在 ../readable.ts。 */

// ─────────────────────────── constructor (P6.§4-§5) ──────────────────────────

const KNOWLEDGE_CONSTRUCTOR_BASIC = "internal/objects/knowledge/constructor/basic";
const KNOWLEDGE_CONSTRUCTOR_INPUT = "internal/objects/knowledge/constructor/input";

const KNOWLEDGE_CONSTRUCTOR_KNOWLEDGE = `
open_knowledge 用于显式打开一个 knowledge doc，作为 knowledge_window 持续可见。

参数：
- path: 必填，knowledge 索引中的路径（不带 .md，例如 "build-tools/file-ops"）

打开后该 knowledge 会强制以 full 形式渲染（绕过 activator 的 method-path 命中规则），
直到显式 close。等价于旧 pinnedKnowledge。

后续：
- 关闭：close(window_id="<knowledge_window_id>")

调用示例：
open(method="open_knowledge", title="pin file-ops", args={ path: "build-tools/file-ops" })
`.trim();

/**
 * P6.§4-§5 constructor —— 创建 explicit knowledge_window。
 *
 * 行为:
 *  - 校验 args.path 非空
 *  - 校验 thread.persistence 上的 knowledge index 含此 path（fail-loud）
 *  - generateWindowId("knowledge") + build KnowledgeWindow（source="explicit"）
 *  - 返回 { ok: true, object: knowledgeWindow }
 *
 * 注意: protocol / activator 来源的 knowledge_window 由系统每轮合成，不走该 constructor。
 */
const knowledgeConstructor: ObjectMethod = {
  kind: "constructor",
  paths: ["open_knowledge"],
  schema: {
    args: {
      path: { type: "string", required: true, description: "knowledge 索引中的路径（不带 .md）" },
    },
  },
  intent: emptyIntent,
  onFormChange: (change, { form }) => {
    if (change.kind === "status_changed" && change.to !== "open") return [];
    // batch C narrowing(N1): onFormChange 的 form 契约层是 base，narrow 回 MethodExecWindow 取 accumulatedArgs。
    const args = change.kind === "args_refined" ? change.args : (form as MethodExecWindow).accumulatedArgs;
    const formStatus = form.status;
    const entries: Record<string, string> = {
      [KNOWLEDGE_CONSTRUCTOR_BASIC]: KNOWLEDGE_CONSTRUCTOR_KNOWLEDGE,
    };
    if (formStatus !== "open") return buildGuidanceWindows(form, entries);
    const path = typeof args.path === "string" ? args.path : "";
    if (!path) {
      entries[KNOWLEDGE_CONSTRUCTOR_INPUT] =
        "open_knowledge 还缺以下参数: path。\n" +
        "请用 refine(form_id, args={ path: \"<knowledge-doc-path-不带.md>\" }) 补齐后 submit(form_id)。\n" +
        "不要 close 重 open——form 当前在 open 状态, refine 是正确路径。";
    }
    return buildGuidanceWindows(form, entries);
  },
  permission: () => "allow",
  exec: async (ctx) => {
    const thread = ctx.thread;
    if (!thread) return { ok: false, error: "[open_knowledge] 缺少 thread context。" };
    const path = typeof ctx.args.path === "string" ? ctx.args.path : "";
    if (!path) return { ok: false, error: "[open_knowledge] 缺少 path。" };

    if (thread.persistence) {
      try {
        const stoneRef = deriveStoneFromThread(thread.persistence);
        const poolRef = derivePoolFromThread(thread.persistence);
        const index = await loadKnowledgeIndex({ stone: stoneRef, pool: poolRef });
        if (!index.byPath.has(path)) {
          return {
            ok: false,
            error:
              `[open_knowledge] knowledge "${path}" 不存在 (index 没有该路径)。可用 grep 在 knowledge/ 下确认路径,或 refine 重新提交。`,
          };
        }
      } catch (err) {
        return { ok: false, error: `[open_knowledge] 校验 path 失败: ${(err as Error).message}` };
      }
    }

    const knowledgeWindow: KnowledgeWindow = {
      id: generateWindowId("knowledge"),
      type: "knowledge",
      parentWindowId: ROOT_WINDOW_ID,
      title: basenameOfPath(path),
      status: "open",
      createdAt: Date.now(),
      path,
      source: "explicit",
      state: { viewport: { ...DEFAULT_VIEWPORT } },
    };
    return { ok: true, object: knowledgeWindow };
  },
};

builtinRegistry.registerExecutable("knowledge", {
  methods: {
    reload: reloadMethod,
    close: closeMethod,
    open_knowledge: knowledgeConstructor,
  },
});
// readable 维度（registerReadable）在 ../readable.ts 自注册（顶部 side-effect import 触发）。
