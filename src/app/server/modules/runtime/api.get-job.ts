import { Elysia, t } from "elysia";
import type { RuntimeService } from "./service";

export function getJobApi(service: RuntimeService) {
  return new Elysia({ name: "ooc.runtime.api.get-job" }).get(
    "/runtime/jobs/:jobId",
    ({ params, set }) => {
      const job = service.getJob(params.jobId);
      if (!job) {
        set.status = 404;
        return { code: "NOT_FOUND", message: `job not found: ${params.jobId}` };
      }
      return job;
    },
    {
      params: t.Object({ jobId: t.String() }),
    }
  );
}
