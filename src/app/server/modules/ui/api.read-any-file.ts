/**
 * GET /api/file/read?path=<abs-or-cwd-relative>&maxBytes=<n?>
 *
 * 服务 UI 中 file_window 详情面板的内容预览需求,允许读取 world 隔离之外的任意
 * 本机路径(file_window.path 通常是项目源码绝对路径)。
 *
 * 注意:本接口不做 baseDir 隔离,只做 NUL / 不存在校验,默认仅本地 dev 使用。
 */
import { Elysia } from "elysia";
import { anyFileQuery } from "./model";
import type { createUiService } from "./service";

export function readAnyFileApi(service: ReturnType<typeof createUiService>) {
  return new Elysia({ name: "ooc.ui.api.read-any-file" }).get(
    "/file/read",
    ({ query }) => service.readAnyFile(query.path, query.maxBytes),
    { query: anyFileQuery }
  );
}
