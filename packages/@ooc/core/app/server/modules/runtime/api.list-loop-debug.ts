import { Elysia } from "elysia";
import type { RuntimeService } from "./service";
import { threadDebugParams } from "./model";

/**
 * R0b (Agent-loop Visualizer plan §5.1):
 *   GET /api/runtime/flows/:sessionId/:objectId/threads/:threadId/debug/loops
 *
 * 列出指定 thread 下所有 loop_NNNN.{input,output,meta}.json 文件, 按 loopIndex 升序
 * 返回 { loops: Array<{ loopIndex, hasInput, hasOutput, hasMeta, meta? }> }.
 *
 * 不携带 input/output 全文 — 前端按需走 GET .../debug/loops/:loopIndex (api.get-loop-debug.ts).
 *
 * 路径末尾是 `/loops` 复数; 与 `/loops/:loopIndex` 单数路径并列 (前者列表, 后者单条).
 *
 * 与 api.get-latest-debug.ts 同样的 baseDir 注入策略 — 不接受 query override.
 *
 * 退化:
 *   debug 目录不存在 / readdir 失败 → 200 + { loops: [] }, 不抛错.
 */
export function listLoopDebugApi(service: RuntimeService, baseDir: string) {
  return new Elysia({ name: "ooc.runtime.api.list-loop-debug" }).get(
    "/runtime/flows/:sessionId/:objectId/threads/:threadId/debug/loops",
    ({ params }) => service.listLoops({
      baseDir,
      sessionId: params.sessionId,
      objectId: params.objectId,
      threadId: params.threadId,
    }),
    { params: threadDebugParams }
  );
}
