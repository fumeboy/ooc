import { Elysia, t } from "elysia";
import { AppServerError } from "../../bootstrap/errors";
import type { RuntimeService } from "./service";

export function getJobApi(service: RuntimeService) {
  return new Elysia({ name: "ooc.runtime.api.get-job" }).get(
    "/runtime/jobs/:jobId",
    ({ params }) => {
      const job = service.getJob(params.jobId);
      if (!job) {
        // throw AppServerError 让 onError handler 统一包络为
        // {error:{code,message,details}}（修裸 {code,message}）。
        throw new AppServerError("NOT_FOUND", `job not found: ${params.jobId}`, { jobId: params.jobId });
      }
      return job;
    },
    {
      params: t.Object({ jobId: t.String() }),
    }
  );
}
