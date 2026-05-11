import { Elysia, t } from "elysia";
import type { RuntimeService } from "./service";

export function listJobsApi(service: RuntimeService) {
  return new Elysia({ name: "ooc.runtime.api.list-jobs" }).get(
    "/runtime/jobs",
    () => service.listJobs(),
    {
      response: t.Object({
        items: t.Array(
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
            error: t.Optional(t.String()),
          })
        ),
      }),
    }
  );
}
