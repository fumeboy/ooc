/**
 * knowledge —— ooc class 后端程序路由（不含 visible 前端）。
 *
 * 一处 `export const Class` 装配 constructor + 三维度（executable / readable）。
 * persistable 走系统默认（不自定义序列化）。
 *
 * knowledge 是**非单例 class**：constructor（open_knowledge）显式 pin 一篇 knowledge doc 进 context。
 * knowledge_base tool-object 经 ctx.runtime.instantiate 委托到此 constructor。
 */

import type { OocClass } from "@ooc/core/runtime/ooc-class.js";
import type { ConstructorContext } from "@ooc/core/executable/contract.js";
import { deriveStoneFromThread } from "@ooc/core/persistable/common.js";
import { derivePoolFromThread } from "@ooc/core/persistable/pool-object.js";
import { loadKnowledgeIndex } from "@ooc/core/thinkable/knowledge/index.js";
import executable from "./executable/index.js";
import readable from "./readable/index.js";
import type { Data } from "./types.js";

export const Class: OocClass<Data> = {
  construct: {
    description: "Explicitly pin a knowledge doc by path so it stays visible in context.",
    schema: {
      args: {
        path: { type: "string", required: true, description: "knowledge 索引中的路径（不带 .md）" },
      },
    },
    exec: async (ctx: ConstructorContext, args: { path?: string }): Promise<Data> => {
      const persistence = ctx.persistence;
      if (!persistence) throw new Error("[open_knowledge] 缺少 persistence context。");
      const path = typeof args.path === "string" ? args.path : "";
      if (!path) throw new Error("[open_knowledge] 缺少 path。");

      if (persistence) {
        const stoneRef = deriveStoneFromThread(persistence);
        const poolRef = derivePoolFromThread(persistence);
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
