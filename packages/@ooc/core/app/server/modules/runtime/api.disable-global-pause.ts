import { Elysia } from "elysia";
import type { RuntimeService } from "./service";
import { RuntimeModel } from "./model";

export function disableGlobalPauseApi(service: RuntimeService) {
  return new Elysia({ name: "ooc.runtime.api.disable-global-pause" }).post(
    "/runtime/global-pause/disable",
    // service.disableGlobalPause 异步扫所有 session 恢复 paused thread；HTTP 层回 { enabled: false }。
    async () => {
      await service.disableGlobalPause();
      return { enabled: false as const };
    },
    { response: RuntimeModel.globalPauseResponse }
  );
}
