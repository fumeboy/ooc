import { Elysia } from "elysia";
import type { RuntimeService } from "./service";
import { RuntimeModel } from "./model";

export function disableGlobalPauseApi(service: RuntimeService) {
  return new Elysia({ name: "ooc.runtime.api.disable-global-pause" }).post(
    "/runtime/global-pause/disable",
    // service.disableGlobalPause 现在异步扫所有 session 恢复 paused thread 并返回
    // resumedThreadIds/jobIds；HTTP 层只回 { enabled: false } 以保持响应契约不破。
    async () => {
      await service.disableGlobalPause();
      return { enabled: false as const };
    },
    { response: RuntimeModel.globalPauseResponse }
  );
}
