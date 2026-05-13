import { Elysia } from "elysia";
import { fileQuery } from "./model";
import type { createUiService } from "./service";

export function getFileApi(service: ReturnType<typeof createUiService>) {
  return new Elysia({ name: "ooc.ui.api.get-file" }).get(
    "/tree/file",
    ({ query }) => service.getFile(query.path),
    { query: fileQuery }
  );
}

