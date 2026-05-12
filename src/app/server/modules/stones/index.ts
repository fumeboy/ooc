import { Elysia } from "elysia";
import type { ServerConfig } from "../../bootstrap/config";
import { callMethodApi } from "./api.call-method";
import { createStoneApi } from "./api.create-stone";
import { getDataApi } from "./api.get-data";
import { getReadmeApi } from "./api.get-readme";
import { getSelfApi } from "./api.get-self";
import { getServerSourceApi } from "./api.get-server-source";
import { getStoneApi } from "./api.get-stone";
import { listStonesApi } from "./api.list-stones";
import { patchDataApi } from "./api.patch-data";
import { putReadmeApi } from "./api.put-readme";
import { putSelfApi } from "./api.put-self";
import { putServerSourceApi } from "./api.put-server-source";
import { createStonesService } from "./service";

export function stonesModule(config: Pick<ServerConfig, "baseDir">) {
  const service = createStonesService({ baseDir: config.baseDir });
  return new Elysia({ prefix: "/api", name: "ooc.stones" })
    .use(listStonesApi(service))
    .use(createStoneApi(service))
    .use(getStoneApi(service))
    .use(getSelfApi(service))
    .use(putSelfApi(service))
    .use(getReadmeApi(service))
    .use(putReadmeApi(service))
    .use(getDataApi(service))
    .use(patchDataApi(service))
    .use(getServerSourceApi(service))
    .use(putServerSourceApi(service))
    .use(callMethodApi(service));
}
