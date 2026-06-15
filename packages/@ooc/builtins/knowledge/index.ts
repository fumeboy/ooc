/**
 * knowledge —— ooc class 后端程序路由（不含 visible 前端）。
 *
 * 一处 `export const Class` 装配 constructor + 三维度（executable / readable）。
 * persistable 走系统默认（不自定义序列化）。
 *
 * knowledge 是**非单例 class**：constructor（open_knowledge）显式 pin 一篇 knowledge doc 进 context。
 * knowledge_base tool-object 经 ctx.runtime.instantiate 委托到此 constructor。
 *
 * deferred hook（契约暂无、Wave3 反推 core 时 re-home）：
 *   - onClose 拒绝逻辑（`rejectCloseNonExplicit`）：合成来源（protocol/activator/relation）的 knowledge
 *     由系统每轮再生，不可显式 close。当前以局部 helper 保留，待 core 提供窗生命周期 hook 后接回。
 */

import type { OocClass } from "@ooc/core/runtime/ooc-class.js";
import type { ConstructorContext } from "@ooc/core/executable/contract.js";
import { deriveStoneFromThread } from "@ooc/core/persistable/common.js";
import { derivePoolFromThread } from "@ooc/core/persistable/pool-object.js";
import { loadKnowledgeIndex } from "@ooc/core/thinkable/knowledge/index.js";
import executable from "./executable/index.js";
import readable from "./readable/index.js";
import type { Data } from "./types.js";

/**
 * deferred hook（Wave3 re-home）：拒绝 close 非 explicit 来源的 knowledge。
 * 合成窗（protocol/activator/relation）由系统每轮合成，LLM 不可显式关闭。
 * 缺 source 字段时按 explicit 处理（向后兼容）。
 */
export function rejectCloseNonExplicit(data: Pick<Data, "source">): boolean {
  return !!data.source && data.source !== "explicit";
}

export const Class: OocClass<Data> = {
  construct: {
    description: "Explicitly pin a knowledge doc by path so it stays visible in context.",
    schema: {
      args: {
        path: { type: "string", required: true, description: "knowledge 索引中的路径（不带 .md）" },
      },
    },
    exec: async (ctx: ConstructorContext, args: { path?: string }): Promise<Data> => {
      const thread = ctx.thread;
      if (!thread) throw new Error("[open_knowledge] 缺少 thread context。");
      const path = typeof args.path === "string" ? args.path : "";
      if (!path) throw new Error("[open_knowledge] 缺少 path。");

      if (thread.persistence) {
        const stoneRef = deriveStoneFromThread(thread.persistence);
        const poolRef = derivePoolFromThread(thread.persistence);
        let index;
        try {
          index = await loadKnowledgeIndex({ stone: stoneRef, pool: poolRef });
        } catch (err) {
          throw new Error(`[open_knowledge] 校验 path 失败: ${(err as Error).message}`);
        }
        if (!index.byPath.has(path)) {
          throw new Error(
            `[open_knowledge] knowledge "${path}" 不存在 (index 没有该路径)。可用 grep 在 knowledge/ 下确认路径,或 refine 重新提交。`,
          );
        }
      }

      return { path, source: "explicit" };
    },
  },
  executable,
  readable,
};

export type { Data } from "./types.js";
