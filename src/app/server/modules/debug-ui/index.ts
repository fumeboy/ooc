import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Elysia } from "elysia";

const moduleDir = dirname(fileURLToPath(import.meta.url));
const chatHtml = readFileSync(join(moduleDir, "chat.html"), "utf8");

function htmlResponse(): Response {
  return new Response(chatHtml, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

/** Debug-only single page UI for manual chat and API inspection. */
export function debugUiModule() {
  return new Elysia({ name: "ooc.debug-ui" })
    .get("/debug", htmlResponse)
    .get("/debug/chat.html", htmlResponse);
}
