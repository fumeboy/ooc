import { Elysia } from "elysia";
import type { RuntimeService } from "./service";
import { RuntimeModel } from "./model";

export function enableGlobalPauseApi(service: RuntimeService) {
  return new Elysia({ name: "ooc.runtime.api.enable-global-pause" }).post(
    "/runtime/global-pause/enable",
    () => service.enableGlobalPause(),
    { response: RuntimeModel.globalPauseResponse }
  );
}
