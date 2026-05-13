import { Elysia } from "elysia";
import type { RuntimeService } from "./service";
import { RuntimeModel } from "./model";

export function enableDebugApi(service: RuntimeService) {
  return new Elysia({ name: "ooc.runtime.api.enable-debug" }).post(
    "/runtime/debug/enable",
    () => service.enableDebug(),
    { response: RuntimeModel.globalPauseResponse }
  );
}
