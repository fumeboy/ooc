import type { OocClass } from "@ooc/core/runtime/ooc-class.js";
import type { World } from "@ooc/core/runtime/ooc-class.js";
import type { ServerConfig } from "@ooc/core/app/server/bootstrap/config.js";
import executable from "./executable/index.js";
import readable from "./readable/index.js";
import { startLarkEventRelay, maybeForwardToLark } from "./event-relay/index.js";
import type { Data } from "./types.js";

export const Class: OocClass<Data> = {
  inheritClass: "_builtin/agent",
  id: "feishu_app",
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
