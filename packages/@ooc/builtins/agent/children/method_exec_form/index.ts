/**
 * method_exec_form —— 「填表式渐进式执行」的 ooc class。
 *
 * 当目标 object method 声明了 `route` 且 route 未返回 quickSubmit 时，exec 工具边界用本 class
 * 的 construct 建一个 form 实例入 thread context（inline 持久化，class key = `method_exec`，
 * persistable 由 registry BASE anchor 声明）。form 自身注册两条 object method：
 * - `refine`：把新 args merge 进 accumulatedArgs、重算 fill / route
 * - `submit`：经 runtime.callMethod 回调目标 method 真正执行（route-free，不递归）
 *
 * readable 把 Data 投影成 `method_exec` 窗，暴露 refine / submit 两个方法菜单。
 */

import type { OocClass } from "@ooc/core/runtime/ooc-class.js";
import type { ConstructorContext } from "@ooc/core/types";
import type { MethodCallSchema } from "@ooc/core/types";
import { buildFillState } from "./schema-fill.js";
import executable from "./executable/index.js";
import readable from "./readable/index.js";
import type { Data } from "./types.js";

/** construct 入参（由 exec 工具边界 instantiate 传入）。 */
interface ConstructArgs {
  targetObjectId?: unknown;
  method?: unknown;
  description?: unknown;
  accumulatedArgs?: unknown;
  tip?: unknown;
  intentPaths?: unknown;
  schema?: unknown;
}

export const Class: OocClass<Data> = {
  id: "_builtin/agent/method_exec_form",
  construct: {
    description: "Open a method-exec form to progressively fill a routed method's args.",
    exec: (_ctx: ConstructorContext, args: ConstructArgs): Data => {
      const targetObjectId = typeof args.targetObjectId === "string" ? args.targetObjectId : "";
      const method = typeof args.method === "string" ? args.method : "";
      if (!targetObjectId || !method) {
        throw new Error("[method_exec_form] construct 缺少 targetObjectId / method。");
      }
      const accumulatedArgs =
        args.accumulatedArgs && typeof args.accumulatedArgs === "object" && !Array.isArray(args.accumulatedArgs)
          ? { ...(args.accumulatedArgs as Record<string, unknown>) }
          : {};
      const intentPaths = Array.isArray(args.intentPaths)
        ? (args.intentPaths as unknown[]).filter((v): v is string => typeof v === "string")
        : [];
      const schema = (args.schema as MethodCallSchema | undefined) ?? undefined;
      return {
        targetObjectId,
        method,
        description: typeof args.description === "string" ? args.description : method,
        accumulatedArgs,
        tip: typeof args.tip === "string" ? args.tip : undefined,
        intentPaths: intentPaths.length > 0 ? intentPaths : [method],
        loadedKnowledgePaths: [],
        methodKnowledgePaths: [],
        status: "open",
        schema,
        fill: buildFillState(schema, accumulatedArgs),
      };
    },
  },
  executable,
  readable,
};

export type { Data } from "./types.js";
