/**
 * knowledge_object — 一段 knowledge 文本作为 Object 出现在 context 中。
 *
 * 2026-05-28 ooc-6 Object Unification: 从 builtin window 迁移为 builtin object，
 * 放置在 packages/@ooc/builtins/knowledge/。
 *
 * 三种 source：
 * - explicit  ：LLM 显式 \`open(command="open_knowledge")\` 创建；持久化；可 close
 * - protocol  ：每轮自动注入的协议常量（KNOWLEDGE）+ 各 command_exec form 的 knowledge() 派生
 * - activator ：stones/{id}/knowledge/*.md 经 commandPaths 命中合成；带 presentation
 *
 * 后两种由 src/executable/index.ts: synthesizeKnowledgeWindows 在 buildInputItems 阶段
 * 合成到 thread.contextWindows 的副本上，不会持久化。
 *
 * 注册的 method：reload / close / set_viewport
 * - reload：强制下一轮重新激活；loader 已按 mtime 失效缓存，主要是语义提示
 * - close：仅 explicit 来源可关闭；protocol / activator 由 onClose hook 拒绝
 */

import type {
  CommandKnowledgeEntries,
  ObjectMethod,
} from "@ooc/core/extendable/_shared/command-types.js";
import { registerObjectType, type OnCloseContext } from "@ooc/core/extendable/_shared/registry.js";
import {
  executeWindowSetViewport,
  hasAnyViewportField,
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
import { readable } from "../readable.js";

const KNOWLEDGE_WINDOW_RELOAD_BASIC = "internal/windows/knowledge/reload/basic";
const KNOWLEDGE_WINDOW_CLOSE_BASIC = "internal/windows/knowledge/close/basic";
const KNOWLEDGE_WINDOW_SET_VIEWPORT_BASIC = "internal/windows/knowledge/set_viewport/basic";
const KNOWLEDGE_WINDOW_SET_VIEWPORT_INPUT = "internal/windows/knowledge/set_viewport/input";

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

const SET_VIEWPORT_KNOWLEDGE = `
knowledge_object.set_viewport 精细化调整渲染窗口（行+列）。

打开 explicit knowledge_object 时默认 viewport = { line_start: 0, line_end: 200, column_start: 0, column_end: 200 }。
对大多数短 markdown 知识等价"全文显示"；超长知识需要扩窗时显式 set_viewport。

参数（**全部可选**，未传字段保留当前值）：
- line_start / line_end / column_start / column_end

约束：非负整数；line_start <= line_end；column_start <= column_end。

渲染：超 line_end 标 \`…(+N more lines)\`；行长 > column_end 标 \`…(+N more)\`。

注意：viewport 仅对 source=explicit 的 knowledge_object 有效；
protocol / activator / relation 来源的 knowledge_object 由系统按 description / full / summary 决定展示形态。
`.trim();

const reloadCommand: ObjectMethod = {
  paths: ["reload"],
  match: () => ["reload"],
  knowledge: (): CommandKnowledgeEntries => ({ [KNOWLEDGE_WINDOW_RELOAD_BASIC]: RELOAD_KNOWLEDGE }),
  exec: () => undefined,
};

const closeCommand: ObjectMethod = {
  paths: ["close"],
  match: () => ["close"],
  knowledge: (): CommandKnowledgeEntries => ({ [KNOWLEDGE_WINDOW_CLOSE_BASIC]: CLOSE_KNOWLEDGE }),
  exec: () => undefined,
};

const setViewportCommand: ObjectMethod = {
  paths: ["set_viewport"],
  match: () => ["set_viewport"],
  knowledge: (args, formStatus): CommandKnowledgeEntries => {
    const entries: CommandKnowledgeEntries = {
      [KNOWLEDGE_WINDOW_SET_VIEWPORT_BASIC]: SET_VIEWPORT_KNOWLEDGE,
    };
    if (formStatus === "open" && !hasAnyViewportField(args)) {
      entries[KNOWLEDGE_WINDOW_SET_VIEWPORT_INPUT] =
        "set_viewport 至少需要传入 line_start / line_end / column_start / column_end 之一。\n" +
        "未传字段保留当前值。请 refine 补齐后 submit。";
    }
    return entries;
  },
  exec: (ctx) => executeWindowSetViewport(ctx, "knowledge"),
};

/** 拒绝 close 非 explicit 来源的 knowledge_object（合成 window 不可关闭）。 */
function onCloseKnowledgeWindow(ctx: OnCloseContext): boolean | void {
  const w = ctx.window;
  if (w.type !== "knowledge") return;
  // 历史 window 没有 source 字段时按 explicit 处理（向后兼容）
  if (w.source && w.source !== "explicit") {
    ctx.thread.events.push({
      category: "context_change",
      kind: "inject",
      text: `[close 拒绝] knowledge_object "${w.path}" 来自 ${w.source}，由系统每轮合成，不可显式关闭。`,
    });
    return false;
  }
}

/** knowledge_object 的 renderXml hook 已迁出到 ../readable.ts。 */

// ─────────────────────────── constructor (P6.§4-§5) ──────────────────────────

const KNOWLEDGE_CONSTRUCTOR_BASIC = "internal/objects/knowledge/constructor/basic";
const KNOWLEDGE_CONSTRUCTOR_INPUT = "internal/objects/knowledge/constructor/input";

const KNOWLEDGE_CONSTRUCTOR_KNOWLEDGE = `
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

function basenameOfPath(p: string): string {
  const idx = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return idx >= 0 ? p.slice(idx + 1) : p;
}

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
  match: () => ["open_knowledge"],
  knowledge: (args, formStatus): CommandKnowledgeEntries => {
    const entries: CommandKnowledgeEntries = {
      [KNOWLEDGE_CONSTRUCTOR_BASIC]: KNOWLEDGE_CONSTRUCTOR_KNOWLEDGE,
    };
    if (formStatus !== "open") return entries;
    const path = typeof args.path === "string" ? args.path : "";
    if (!path) {
      entries[KNOWLEDGE_CONSTRUCTOR_INPUT] =
        "open_knowledge 还缺以下参数: path。\n" +
        "请用 refine(form_id, args={ path: \"<knowledge-doc-path-不带.md>\" }) 补齐后 submit(form_id)。\n" +
        "不要 close 重 open——form 当前在 open 状态, refine 是正确路径。";
    }
    return entries;
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
      viewport: { ...DEFAULT_VIEWPORT },
    };
    return { ok: true, object: knowledgeWindow };
  },
};

registerObjectType("knowledge", {
  commands: {
    reload: reloadCommand,
    close: closeCommand,
    set_viewport: setViewportCommand,
    open_knowledge: knowledgeConstructor,
  },
  onClose: onCloseKnowledgeWindow,
  readable,
});
