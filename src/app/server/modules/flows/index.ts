import { Elysia } from "elysia";
import type { ServerConfig } from "../../bootstrap/config";
import { createJobManager } from "../../runtime/job-manager";
import { createPauseStore } from "../../runtime/pause-store";
import { callMethodApi } from "./api.call-method";
import { createFlowObjectApi } from "./api.create-flow-object";
import { createSessionApi } from "./api.create-session";
import { getFlowObjectApi } from "./api.get-flow-object";
import { getThreadApi } from "./api.get-thread";
import { pauseSessionApi } from "./api.pause-session";
import { resumeSessionApi } from "./api.resume-session";
import { createFlowsService } from "./service";

const defaultPauseStore = createPauseStore();
const defaultJobManager = createJobManager();

export function flowsModule(
  config: Pick<ServerConfig, "baseDir"> & {
    pauseStore?: import("../../runtime/pause-store").PauseStore;
    jobManager?: ReturnType<typeof createJobManager>;
  }
) {
  const service = createFlowsService({
    baseDir: config.baseDir,
    pauseStore: config.pauseStore ?? defaultPauseStore,
    jobManager: config.jobManager ?? defaultJobManager,
  });

  return new Elysia({ prefix: "/api", name: "ooc.flows" })
    .use(createSessionApi(service))
    .use(createFlowObjectApi(service))
    .use(getFlowObjectApi(service))
    .use(getThreadApi(service))
    .use(pauseSessionApi(service))
    .use(resumeSessionApi(service))
    .use(callMethodApi(service));
}
