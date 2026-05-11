import { Elysia } from "elysia";
import type { RuntimeService } from "./service";
import { RuntimeModel } from "./model";

export function getGlobalPauseStatusApi(service: RuntimeService) {
  return new Elysia({ name: "ooc.runtime.api.get-global-pause-status" }).get(
    "/runtime/global-pause/status",
    () => service.getGlobalPauseStatus(),
    { response: RuntimeModel.globalPauseResponse }
  );
}
