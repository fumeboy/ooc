import { Elysia } from "elysia";
import type { ServerConfig } from "../../bootstrap/config";
import { addUserTalkWindowApi } from "./api.add-user-talk-window";
import { callMethodApi } from "./api.call-method";
import { createFlowObjectApi } from "./api.create-flow-object";
import { createSessionApi } from "./api.create-session";
import { getFlowObjectApi } from "./api.get-flow-object";
import { getThreadApi } from "./api.get-thread";
import { listThreadsApi } from "./api.list-threads";
import { continueThreadApi } from "./api.continue-thread";
import { pauseSessionApi } from "./api.pause-session";
import { resumeSessionApi } from "./api.resume-session";
import { seedSessionApi } from "./api.seed-session";
import { createFlowsService } from "./service";

export function flowsModule(config: ServerConfig) {
  const service = createFlowsService({
    baseDir: config.baseDir,
    pauseStore: config.pauseStore,
    jobManager: config.jobManager,
  });

  return new Elysia({ prefix: "/api", name: "ooc.flows" })
    .use(seedSessionApi(service))
    .use(addUserTalkWindowApi(service))
    .use(createSessionApi(service))
    .use(createFlowObjectApi(service))
    .use(getFlowObjectApi(service))
    .use(getThreadApi(service))
    .use(listThreadsApi(service))
    .use(continueThreadApi(service))
    .use(pauseSessionApi(service))
    .use(resumeSessionApi(service))
    .use(callMethodApi(service));
}
