export const endpoints = {
  health: "/api/health",
  stones: "/api/stones",
  stoneKnowledgeDirectories: (objectId: string) => `/api/stones/${encodeURIComponent(objectId)}/knowledge/directories`,
  stoneKnowledgeFiles: (objectId: string) => `/api/stones/${encodeURIComponent(objectId)}/knowledge/files`,
  flows: "/api/flows",
  pauseSession: (sessionId: string) => `/api/flows/${encodeURIComponent(sessionId)}/pause`,
  resumeSession: (sessionId: string) => `/api/flows/${encodeURIComponent(sessionId)}/resume`,
  tree: "/api/tree",
  file: "/api/tree/file",
  createFlowObject: (sessionId: string) => `/api/flows/${encodeURIComponent(sessionId)}/objects/`,
  thread: (sessionId: string, objectId: string, threadId = "root") =>
    `/api/flows/${encodeURIComponent(sessionId)}/objects/${encodeURIComponent(objectId)}/threads/${encodeURIComponent(threadId)}`,
  continueThread: (sessionId: string, objectId: string, threadId = "root") =>
    `/api/flows/${encodeURIComponent(sessionId)}/objects/${encodeURIComponent(objectId)}/threads/${encodeURIComponent(threadId)}/continue`,
  job: (jobId: string) => `/api/runtime/jobs/${encodeURIComponent(jobId)}`,
  runtimeGlobalPauseStatus: "/api/runtime/global-pause/status",
  runtimeGlobalPauseEnable: "/api/runtime/global-pause/enable",
  runtimeGlobalPauseDisable: "/api/runtime/global-pause/disable",
  runtimeDebugStatus: "/api/runtime/debug/status",
  runtimeDebugEnable: "/api/runtime/debug/enable",
  runtimeDebugDisable: "/api/runtime/debug/disable",
};
