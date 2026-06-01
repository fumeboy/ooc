import { Elysia } from "elysia";
import type { RuntimeService } from "./service";
import { RuntimeModel } from "./model";

export function disableDebugApi(service: RuntimeService) {
  return new Elysia({ name: "ooc.runtime.api.disable-debug" }).post(
    "/runtime/debug/disable",
    () => service.disableDebug(),
    { response: RuntimeModel.globalPauseResponse }
  );
}
