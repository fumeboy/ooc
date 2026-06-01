import { Elysia } from "elysia";
import { treeQuery } from "./model";
import type { createUiService } from "./service";

export function getTreeApi(service: ReturnType<typeof createUiService>) {
  return new Elysia({ name: "ooc.ui.api.get-tree" }).get(
    "/tree",
    ({ query }) => service.getTree(query),
    { query: treeQuery }
  );
}

