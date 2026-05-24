import { Elysia } from "elysia";
import type { ServerConfig } from "../../bootstrap/config";
import { clientSourceUrlApi } from "./api.client-source-url";
import { getFileApi } from "./api.get-file";
import { getTreeApi } from "./api.get-tree";
import { readAnyFileApi } from "./api.read-any-file";
import { listWindowTypesApi } from "./api.list-window-types";
import { createUiService } from "./service";

export function uiModule(config: Pick<ServerConfig, "baseDir" | "stonesBranch">) {
  const service = createUiService({ baseDir: config.baseDir });
  return new Elysia({ prefix: "/api", name: "ooc.ui" })
    .use(getTreeApi(service))
    .use(getFileApi(service))
    .use(readAnyFileApi(service))
    .use(listWindowTypesApi())
    .use(clientSourceUrlApi(config));
}
