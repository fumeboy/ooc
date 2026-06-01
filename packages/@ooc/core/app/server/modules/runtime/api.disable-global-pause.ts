import { Elysia } from "elysia";
import type { RuntimeService } from "./service";
import { RuntimeModel } from "./model";

export function disableGlobalPauseApi(service: RuntimeService) {
  return new Elysia({ name: "ooc.runtime.api.disable-global-pause" }).post(
    "/runtime/global-pause/disable",
    () => service.disableGlobalPause(),
    { response: RuntimeModel.globalPauseResponse }
  );
}
