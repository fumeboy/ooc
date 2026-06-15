/**
 * feishu_app —— 飞书应用接入点的**单例 object**（带自定义方法）。
 *
 * 一处 `export const Class: OocClass<Data>` 装配 own executable（open_chat / open_doc）+ readable
 * （接入面板投影）。feishu_app 无 construct——它是单例 object，实例数据由 bootstrap 实例化时
 * 据空 Data 产出（继承 agent 的 agency 经 class 链）。
 *
 * 装载链：
 * - windows/index.ts 显式 `builtinRegistry.register("feishu_app", Class, { parentClass: "_builtin/agent" })`
 *   注册一个名为 `feishu_app` 的 class（own method + 继承 agent）。
 * - bootstrap `instantiateBuiltinClassObjects` 据本包 package.json `ooc.kind:"object"` + `ooc.class:"feishu_app"`
 *   建实例 `objects/feishu_app`，实例 stone `class` 字段 = `"feishu_app"`。
 * - dispatch 按实例 `class="feishu_app"` 解析继承链 [feishu_app, agent, root]：own open_chat/open_doc
 *   + 继承 agent 的 talk/plan/todo/end。
 *
 * 也 re-export event-relay 的 startLarkEventRelay / maybeForwardToLark 供 app/server 接线。
 */

import type { OocClass } from "@ooc/core/runtime/ooc-class.js";
import type { World } from "@ooc/core/runtime/ooc-class.js";
import type { ServerConfig } from "@ooc/core/app/server/bootstrap/config.js";
import executable from "./executable/index.js";
import readable from "./readable/index.js";
import { startLarkEventRelay, maybeForwardToLark } from "./event-relay/index.js";
import type { Data } from "./types.js";

export const Class: OocClass<Data> = {
  executable,
  readable,
  // World 启动时执行：起飞书消息反向通道（lark event relay）。relay 内部据 .world.json
  // 的 LarkAppId/Secret 决定是否真启动（未配置则 no-op）。返回错误信息（空=成功）。
  init: async (world: World): Promise<string> => {
    try {
      await startLarkEventRelay({ baseDir: world.baseDir } as unknown as ServerConfig);
      return "";
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  },
};

export type { Data } from "./types.js";

export { startLarkEventRelay, maybeForwardToLark };
export { larkExec, larkCheckAuth, LarkCliError } from "./cli.js";
export type { LarkExecOptions, LarkExecResult } from "./cli.js";
