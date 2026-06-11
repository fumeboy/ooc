import { Elysia, t } from "elysia";
import type { RuntimeService } from "./service";

/**
 * GET /api/runtime/activity —— 系统活动快照（observable 诊断端点）。
 *
 * 一次读出服务端此刻全貌，把「长跑卡住只能盲等到超时再 tail 日志」变成「随时一读即诊断」：
 * - `jobs`：在跑/排队/最近结束的 job，running 带 `ageMs`（跑了多久 → 定位卡住）+
 *   `statusReason`（结构化失败原因）。
 * - `runningCount`：系统是否在动的快判。
 * - `logPatterns`：主导日志模式（来自 log-aggregator，按次数降序）——定位「被什么重复
 *   事件刷屏」（如 readThread missing-object ×370）。
 *
 * 消费方：控制面 UI 实时面板 + harness 超时前快照（orchestrate.ts fetch 后写进报告）。
 */
export function activityApi(service: RuntimeService) {
  return new Elysia({ name: "ooc.runtime.api.activity" }).get(
    "/runtime/activity",
    () => service.getActivity(),
    {
      response: t.Object({
        now: t.Number(),
        runningCount: t.Number(),
        jobs: t.Array(
          t.Object({
            jobId: t.String(),
            kind: t.Union([t.Literal("run-thread"), t.Literal("resume-thread")]),
            sessionId: t.String(),
            objectId: t.String(),
            threadId: t.String(),
            status: t.Union([
              t.Literal("queued"),
              t.Literal("running"),
              t.Literal("done"),
              t.Literal("failed"),
            ]),
            startedAt: t.Optional(t.Number()),
            finishedAt: t.Optional(t.Number()),
            ageMs: t.Optional(t.Number()),
            error: t.Optional(t.String()),
            statusReason: t.Optional(t.String()),
          }),
        ),
        logPatterns: t.Array(
          t.Object({
            key: t.String(),
            level: t.Union([t.Literal("info"), t.Literal("warn"), t.Literal("error")]),
            count: t.Number(),
            firstTs: t.Number(),
            lastTs: t.Number(),
            sample: t.String(),
          }),
        ),
      }),
    },
  );
}
