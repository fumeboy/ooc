export const endpoints = {
  health: "/api/health",
  stones: "/api/stones",
  stoneKnowledgeDirectories: (objectId: string) => `/api/stones/${encodeURIComponent(objectId)}/knowledge/directories`,
  stoneKnowledgeFiles: (objectId: string) => `/api/stones/${encodeURIComponent(objectId)}/knowledge/files`,
  flows: "/api/flows",
  /** collaborable § cross-object talk: 一次性 seed 一个 session（user → talk → target）。 */
  sessions: "/api/sessions",
  pauseSession: (sessionId: string) => `/api/flows/${encodeURIComponent(sessionId)}/pause`,
  resumeSession: (sessionId: string) => `/api/flows/${encodeURIComponent(sessionId)}/resume`,
  /** 列出 session 下所有 (objectId, threadId) — UI thread 切换器数据源。 */
  sessionThreads: (sessionId: string) => `/api/flows/${encodeURIComponent(sessionId)}/threads`,
  tree: "/api/tree",
  file: "/api/tree/file",
  createFlowObject: (sessionId: string) => `/api/flows/${encodeURIComponent(sessionId)}/objects/`,
  thread: (sessionId: string, objectId: string, threadId = "root") =>
    `/api/flows/${encodeURIComponent(sessionId)}/objects/${encodeURIComponent(objectId)}/threads/${encodeURIComponent(threadId)}`,
  /** 控制面用户回复：固定走 user.root.talk_window；body 含 text + targetWindowId? */
  continueThread: (sessionId: string) => `/api/flows/${encodeURIComponent(sessionId)}/continue`,
  job: (jobId: string) => `/api/runtime/jobs/${encodeURIComponent(jobId)}`,
  runtimeGlobalPauseStatus: "/api/runtime/global-pause/status",
  runtimeGlobalPauseEnable: "/api/runtime/global-pause/enable",
  runtimeGlobalPauseDisable: "/api/runtime/global-pause/disable",
  runtimeDebugStatus: "/api/runtime/debug/status",
  runtimeDebugEnable: "/api/runtime/debug/enable",
  runtimeDebugDisable: "/api/runtime/debug/disable",
  /** Stone 级 server ui_methods 调用入口。 */
  stoneCallMethod: (objectId: string) =>
    `/api/stones/${encodeURIComponent(objectId)}/call_method`,
  /** Flow object 级 server ui_methods 调用入口。 */
  flowCallMethod: (sessionId: string, objectId: string) =>
    `/api/flows/${encodeURIComponent(sessionId)}/objects/${encodeURIComponent(objectId)}/call_method`,
};
