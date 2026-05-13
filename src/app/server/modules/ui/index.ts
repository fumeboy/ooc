import { Elysia } from "elysia";
import type { ServerConfig } from "../../bootstrap/config";
import { getFileApi } from "./api.get-file";
import { getTreeApi } from "./api.get-tree";
import { createUiService } from "./service";

export function uiModule(config: Pick<ServerConfig, "baseDir">) {
  const service = createUiService({ baseDir: config.baseDir });
  return new Elysia({ prefix: "/api", name: "ooc.ui" })
    .use(getTreeApi(service))
    .use(getFileApi(service));
}
