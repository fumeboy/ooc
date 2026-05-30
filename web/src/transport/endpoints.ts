/**
 * ooc-3 endpoint map — the single adaptation chokepoint for the ooc-2→ooc-3 migration.
 *
 * All ooc-2 endpoint names are preserved so existing domain queries compile;
 * the paths point to ooc-3 routes.
 */
export const endpoints = {
  health: "/api/health",
  /** World config (ooc-2: /api/world/config; ooc-3 compat alias) */
  worldConfig: "/api/world/config",
  /** World info (ooc-3 native) */
  world: "/api/world",
  /** Stone list */
  stones: "/api/stones",
  /** Stone self.md (ooc-3 path includes branch) */
  stoneSelf: (branch: string, name: string) =>
    `/api/stones/${encodeURIComponent(branch)}/${encodeURIComponent(name)}/self`,
  /** Stone readme.md */
  stoneReadme: (branch: string, name: string) =>
    `/api/stones/${encodeURIComponent(branch)}/${encodeURIComponent(name)}/readme`,
  /** Stone detail */
  stoneDetail: (branch: string, name: string) =>
    `/api/stones/${encodeURIComponent(branch)}/${encodeURIComponent(name)}`,
  /** Stone call-method */
  stoneCallMethod: (branch: string, name: string) =>
    `/api/stones/${encodeURIComponent(branch)}/${encodeURIComponent(name)}/call-method`,
  /**
   * ooc-2 compat: /api/stones/:objectId/self → ooc-3 /api/stones/main/:name/self
   * Domain queries (objects/query.ts) call /api/stones/:id/self with just the name.
   * We adapt by hardcoding "main" branch.
   */
  legacyStoneSelf: (objectId: string) =>
    `/api/stones/main/${encodeURIComponent(objectId)}/self`,
  legacyStoneReadme: (objectId: string) =>
    `/api/stones/main/${encodeURIComponent(objectId)}/readme`,
  /** Rich session list (ooc-2 compat: /api/flows) */
  flows: "/api/flows",
  /** Native session list */
  sessions: "/api/sessions",
  /** Session detail */
  sessionDetail: (sessionId: string) =>
    `/api/sessions/${encodeURIComponent(sessionId)}`,
  /** Session threads list */
  sessionThreads: (sessionId: string) =>
    `/api/flows/${encodeURIComponent(sessionId)}/threads`,
  /** Pause session */
  pauseSession: (sessionId: string) =>
    `/api/flows/${encodeURIComponent(sessionId)}/pause`,
  /** Resume session */
  resumeSession: (sessionId: string) =>
    `/api/flows/${encodeURIComponent(sessionId)}/resume`,
  /** Continue thread (ooc-2 compat, wraps /api/talk) */
  continueThread: (sessionId: string) =>
    `/api/flows/${encodeURIComponent(sessionId)}/continue`,
  /** Job poll (ooc-3: always returns done synchronously) */
  job: (jobId: string) =>
    `/api/runtime/jobs/${encodeURIComponent(jobId)}`,
  /** Thread detail */
  thread: (sessionId: string, objectId: string, threadId = "root") =>
    `/api/flows/${encodeURIComponent(sessionId)}/objects/${encodeURIComponent(objectId)}/threads/${encodeURIComponent(threadId)}`,
  /** File tree (supports depth + recursive params) */
  tree: "/api/tree",
  /** File read */
  readAnyFile: "/api/file/read",
  file: "/api/tree/file",
  /** Client source URL for stones (scope = branch name in ooc-3) */
  clientSourceUrl: (scope: "stone" | "flow", objectId: string, opts?: { sessionId?: string; page?: string }) => {
    // ooc-3: scope param is branch name (e.g. "main"), not "stone"/"flow" keyword
    const ooc3Scope = scope === "stone" ? "main" : "main";
    const base = `/api/objects/${ooc3Scope}/${encodeURIComponent(objectId)}/client-source-url`;
    if (scope === "stone") return base;
    const params = new URLSearchParams();
    if (opts?.sessionId) params.set("sessionId", opts.sessionId);
    if (opts?.page) params.set("page", opts.page);
    const qs = params.toString();
    return qs ? `${base}?${qs}` : base;
  },
  /** Knowledge (stub paths — not implemented in ooc-3 yet; placeholder for Batch 4) */
  stoneKnowledgeDirectories: (objectId: string) =>
    `/api/stones/main/${encodeURIComponent(objectId)}/knowledge/directories`,
  stoneKnowledgeFiles: (objectId: string) =>
    `/api/stones/main/${encodeURIComponent(objectId)}/knowledge/files`,
  /** Add talk window (not in ooc-3 yet) */
  addUserTalkWindow: (sessionId: string) =>
    `/api/flows/${encodeURIComponent(sessionId)}/talk-windows`,
  /** Create flow object (not in ooc-3 yet) */
  createFlowObject: (sessionId: string) =>
    `/api/flows/${encodeURIComponent(sessionId)}/objects/`,
  /** Runtime stubs (not in ooc-3 yet — return graceful 404) */
  runtimeGlobalPauseStatus: "/api/runtime/global-pause/status",
  runtimeGlobalPauseEnable: "/api/runtime/global-pause/enable",
  runtimeGlobalPauseDisable: "/api/runtime/global-pause/disable",
  runtimeDebugStatus: "/api/runtime/debug/status",
  runtimeDebugEnable: "/api/runtime/debug/enable",
  runtimeDebugDisable: "/api/runtime/debug/disable",
  runtimeListLoops: (sessionId: string, objectId: string, threadId: string) =>
    `/api/runtime/flows/${encodeURIComponent(sessionId)}/objects/${encodeURIComponent(objectId)}/threads/${encodeURIComponent(threadId)}/debug/loops`,
  runtimeGetLoopDebug: (sessionId: string, objectId: string, threadId: string, loopIndex: number) =>
    `/api/runtime/flows/${encodeURIComponent(sessionId)}/objects/${encodeURIComponent(objectId)}/threads/${encodeURIComponent(threadId)}/debug/loops/${loopIndex}`,
  runtimeDecidePermission: (sessionId: string, objectId: string, threadId: string) =>
    `/api/runtime/flows/${encodeURIComponent(sessionId)}/objects/${encodeURIComponent(objectId)}/threads/${encodeURIComponent(threadId)}/permission`,
  /** Flow call method */
  flowCallMethod: (sessionId: string, objectId: string) =>
    `/api/flows/${encodeURIComponent(sessionId)}/objects/${encodeURIComponent(objectId)}/call_method`,
};
