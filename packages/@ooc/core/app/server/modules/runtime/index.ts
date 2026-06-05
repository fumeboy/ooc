import { Elysia } from "elysia";
import type { ServerConfig } from "../../bootstrap/config";
import { createJobManager } from "../../runtime/job-manager";
import { createPauseStore } from "../../runtime/pause-store";
import { disableGlobalPauseApi } from "./api.disable-global-pause";
import { disableDebugApi } from "./api.disable-debug";
import { enableGlobalPauseApi } from "./api.enable-global-pause";
import { enableDebugApi } from "./api.enable-debug";
import { getDebugStatusApi } from "./api.get-debug-status";
import { getGlobalPauseStatusApi } from "./api.get-global-pause-status";
import { getJobApi } from "./api.get-job";
import { getLatestDebugApi } from "./api.get-latest-debug";
import { getLlmConfigApi } from "./api.get-llm-config";
import { getLoopDebugApi } from "./api.get-loop-debug";
import { listJobsApi } from "./api.list-jobs";
import { listLoopDebugApi } from "./api.list-loop-debug";
import { permissionDecisionApi } from "./api.permission-decision";
import { createRuntimeService } from "./service";

const defaultPauseStore = createPauseStore();
const defaultJobManager = createJobManager();

type RuntimeModuleConfig = ServerConfig & {
  pauseStore?: ReturnType<typeof createPauseStore>;
  jobManager?: ReturnType<typeof createJobManager>;
};

export function runtimeModule(config: RuntimeModuleConfig) {
  const service = createRuntimeService({
    baseDir: config.baseDir,
    pauseStore: config.pauseStore ?? defaultPauseStore,
    jobManager: config.jobManager ?? defaultJobManager,
  });

  return new Elysia({ prefix: "/api", name: "ooc.runtime" })
    .use(getLlmConfigApi(service))
    .use(listJobsApi(service))
    .use(getJobApi(service))
    .use(enableGlobalPauseApi(service))
    .use(disableGlobalPauseApi(service))
    .use(getGlobalPauseStatusApi(service))
    .use(enableDebugApi(service))
    .use(disableDebugApi(service))
    .use(getDebugStatusApi(service))
    .use(getLatestDebugApi(service, config.baseDir))
    .use(getLoopDebugApi(service, config.baseDir))
    .use(listLoopDebugApi(service, config.baseDir))
    .use(permissionDecisionApi(service, config.baseDir));
}
