import { Elysia } from "elysia";
import type { ServerConfig } from "../../bootstrap/config";
import { callMethodApi } from "./api.call-method";
import { createKnowledgeDirectoryApi } from "./api.create-knowledge-directory";
import { createKnowledgeFileApi } from "./api.create-knowledge-file";
import { createStoneApi } from "./api.create-stone";
import { getReadmeApi } from "./api.get-readme";
import { getSelfApi } from "./api.get-self";
import { getExecutableSourceApi } from "./api.get-executable-source";
import { getStoneApi } from "./api.get-stone";
import { listStonesApi } from "./api.list-stones";
import { putReadmeApi } from "./api.put-readme";
import { putKnowledgeFileApi } from "./api.put-knowledge-file";
import { putSelfApi } from "./api.put-self";
import { putExecutableSourceApi } from "./api.put-executable-source";
import { createStonesService } from "./service";

export function stonesModule(config: Pick<ServerConfig, "baseDir" | "stonesBranch">) {
  const service = createStonesService({ baseDir: config.baseDir, stonesBranch: config.stonesBranch });
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
    .use(getExecutableSourceApi(service))
    .use(putExecutableSourceApi(service))
    .use(callMethodApi(service));
}
