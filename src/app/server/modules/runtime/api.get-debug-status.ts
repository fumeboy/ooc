import { Elysia } from "elysia";
import type { RuntimeService } from "./service";
import { RuntimeModel } from "./model";

export function getDebugStatusApi(service: RuntimeService) {
  return new Elysia({ name: "ooc.runtime.api.get-debug-status" }).get(
    "/runtime/debug/status",
    () => service.getDebugStatus(),
    { response: RuntimeModel.globalPauseResponse }
  );
}
