import { Elysia } from "elysia";
import type { ServerConfig } from "../../bootstrap/config";
import type { WorldRuntime } from "@ooc/core/runtime";
import { callMethodApi } from "./api.call-method";
import { createKnowledgeDirectoryApi } from "./api.create-knowledge-directory";
import { createKnowledgeFileApi } from "./api.create-knowledge-file";
import { createStoneApi } from "./api.create-stone";
import { getReadmeApi } from "./api.get-readme";
import { getSelfApi } from "./api.get-self";
import { getServerSourceApi } from "./api.get-server-source";
import { getStoneApi } from "./api.get-stone";
import { listStonesApi } from "./api.list-stones";
import { putReadmeApi } from "./api.put-readme";
import { putKnowledgeFileApi } from "./api.put-knowledge-file";
import { putSelfApi } from "./api.put-self";
import { putServerSourceApi } from "./api.put-server-source";
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
    .use(putSelfApi(service))
    .use(getReadmeApi(service))
    .use(putReadmeApi(service))
    .use(getServerSourceApi(service))
    .use(putServerSourceApi(service))
    .use(callMethodApi(service));
}
