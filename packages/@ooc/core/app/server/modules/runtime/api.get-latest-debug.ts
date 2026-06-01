import { Elysia } from "elysia";
import type { RuntimeService } from "./service";
import { threadDebugParams } from "./model";

/**
 * Round 8 B5 fix: 之前 fallback 到 `process.cwd()` 导致 server 在隔离 world 下
 * 启动时（如 `--world /tmp/ooc-foo-world`），debug 文件查找路径仍指向项目源码目录，
 * 永远 404。改为接收 server 配置的 `baseDir`，与 flows/stones 模块对齐。
 *
 * R8-4 fix (security, 2026-05-25): 删除 `?baseDir=` query override。之前保留是为了
 * 测试入口能力，但 query override 让外部 caller 能 `?baseDir=/etc` 读 host fs
 * （限于 debug 文件名命名空间内仍是设计漏洞）。server config baseDir 注入已是
 * 唯一可信来源；测试用直接构造 service 即可，不必走 query。
 */
export function getLatestDebugApi(service: RuntimeService, baseDir: string) {
  return new Elysia({ name: "ooc.runtime.api.get-latest-debug" }).get(
    "/runtime/flows/:sessionId/:objectId/threads/:threadId/debug",
    ({ params }) => service.getLatestDebug({
      baseDir,
      sessionId: params.sessionId,
      objectId: params.objectId,
      threadId: params.threadId,
    }),
    { params: threadDebugParams }
  );
}
