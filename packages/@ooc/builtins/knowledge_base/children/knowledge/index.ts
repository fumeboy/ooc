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
import type { ConstructorContext } from "@ooc/core/types";
import executable from "./executable/index.js";
import readable from "./readable/index.js";
import type { Data } from "./types.js";

export const Class: OocClass<Data> = {
  id: "_builtin/knowledge_base/knowledge",
  construct: {
    description: "Explicitly pin a knowledge doc by path so it stays visible in context.",
    schema: {
      args: {
        path: { type: "string", required: true, description: "knowledge 索引中的路径（不带 .md）" },
      },
    },
    exec: async (ctx: ConstructorContext, args: { path?: string }): Promise<Data> => {
      const path = typeof args.path === "string" ? args.path : "";
      if (!path) throw new Error("[open_knowledge] 缺少 path。");

      // TODO
      return {}
    },
  },
  executable,
  readable,
};

export type { Data } from "./types.js";
