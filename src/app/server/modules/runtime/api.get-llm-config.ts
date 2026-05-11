import { Elysia } from "elysia";
import type { RuntimeService } from "./service";
import { RuntimeModel } from "./model";

export function getLlmConfigApi(service: RuntimeService) {
  return new Elysia({ name: "ooc.runtime.api.get-llm-config" }).get(
    "/runtime/llm-config",
    () => service.getLlmConfig(),
    { response: RuntimeModel.llmConfigResponse }
  );
}
