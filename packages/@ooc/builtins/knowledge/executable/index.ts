/**
 * knowledge_object — 一段 knowledge 文本作为 Object 出现在 context 中。
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

import type { MethodExecWindow } from "@ooc/core/executable/windows/method_exec/types.js";
import { basenameOfPath } from "@ooc/builtins/_shared/executable/utils.js";

const reloadMethod: ObjectMethod = {
  description: "Force knowledge re-activation next turn (loader auto-invalidates by mtime; this is a semantic hint).",
  exec: () => undefined,
};

const closeMethod: ObjectMethod = {
  description: "Close this explicit knowledge window (protocol/activator knowledge cannot be closed).",
  exec: () => undefined,
};

// ─────────────────────────── constructor (P6.§4-§5) ──────────────────────────

const OPEN_KNOWLEDGE_TIP = `open_knowledge 显式打开一个 knowledge doc，作为 knowledge_window 持续可见（等价于 pinnedKnowledge）。
参数：path（必填，knowledge 索引中的路径，不带 .md，如 "build-tools/file-ops"）。`;

const knowledgeConstructor: ObjectMethod = {
  kind: "constructor",
  description: "Explicitly pin a knowledge doc by path so it stays visible in context.",
  intents: ["open_knowledge"],
  schema: {
    args: {
      path: { type: "string", required: true, description: "knowledge 索引中的路径（不带 .md）" },
    },
  },
  onFormChange(change, { form }) {
    const args = (form as MethodExecWindow).accumulatedArgs;
    let tip = OPEN_KNOWLEDGE_TIP;
    let quick_exec_submit = false;
    const path = typeof args.path === "string" ? args.path : "";
    if (path) {
      quick_exec_submit = true;
      tip = `Opening knowledge ${path}...`;
    }
    return { tip, intents: [{ name: "open_knowledge" }], quick_exec_submit };
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
    return { ok: true, window: knowledgeWindow };
  },
};

builtinRegistry.registerExecutable("knowledge", {
  methods: {
    reload: reloadMethod,
    close: closeMethod,
    open_knowledge: knowledgeConstructor,
  },
});
