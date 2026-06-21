import { Elysia } from "elysia";
import type { ServerConfig } from "../../bootstrap/config";
import type { WorldRuntime } from "@ooc/core/runtime";
import { callMethodApi } from "./api.call-method";
import { createKnowledgeDirectoryApi } from "./api.create-knowledge-directory";
import { createKnowledgeFileApi } from "./api.create-knowledge-file";
import { createStoneApi } from "./api.create-stone";
import { getReadableApi } from "./api.get-readable";
import { getSelfApi } from "./api.get-self";
import { getServerSourceApi } from "./api.get-server-source";
import { getStoneApi } from "./api.get-stone";
import { listStonesApi } from "./api.list-stones";
import { putFileApi } from "./api.put-file";
import { putKnowledgeFileApi } from "./api.put-knowledge-file";
import { createStonesService } from "./service";

export function stonesModule(
  config: Pick<ServerConfig, "baseDir">,
  runtime?: Pick<WorldRuntime, "stoneRegistry">,
) {
  const service = createStonesService({
    baseDir: config.baseDir,
    stoneRegistry: runtime?.stoneRegistry,
  });
  return new Elysia({ prefix: "/api", name: "ooc.stones" })
    .use(listStonesApi(service))
    .use(createStoneApi(service))
    .use(createKnowledgeDirectoryApi(service))
    .use(createKnowledgeFileApi(service))
    .use(putKnowledgeFileApi(service))
    .use(getStoneApi(service))
    .use(getSelfApi(service))
    .use(getReadableApi(service))
    .use(getServerSourceApi(service))
    .use(putFileApi(service))
    .use(callMethodApi(service));
}
