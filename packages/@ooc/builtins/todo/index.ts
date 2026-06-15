/**
 * todo —— ooc class 后端程序路由（不含 visible 前端）。
 *
 * 一处 `export const Class` 装配 construct + 两维度（executable / readable）。
 * todo 是**非单例 class**（root.todo 一步直建，可建多个）；persistable 走系统默认（不自定义）。
 */

import type { OocClass } from "@ooc/core/runtime/ooc-class.js";
import type { ConstructorContext } from "@ooc/core/executable/contract.js";
import executable from "./executable/index.js";
import readable from "./readable/index.js";
import type { Data } from "./types.js";

export const Class: OocClass<Data> = {
  construct: {
    description: "Create a visible todo item in context.",
    schema: {
      args: {
        content: { type: "string", required: true, description: "待办内容" },
        activates_on: { type: "array", description: "命中这些 intent 时强提醒" },
      },
    },
    exec: (_ctx: ConstructorContext, args: { content?: unknown; activates_on?: unknown }): Data => {
      const content = typeof args.content === "string" ? args.content : "";
      if (!content.trim()) throw new Error("[todo] 缺少 content 参数。");
      const activatesOn = Array.isArray(args.activates_on)
        ? (args.activates_on as unknown[]).filter((v): v is string => typeof v === "string")
        : undefined;
      return {
        content,
        activatesOn: activatesOn && activatesOn.length > 0 ? activatesOn : undefined,
        status: "open",
      };
    },
  },
  executable,
  readable,
};

export type { Data } from "./types.js";
