export const endpoints = {
  health: "/api/health",
  stones: "/api/stones",
  /**
   * 根因 #3 (2026-05-24)：knowledge 实际写入 pool 层，路径迁到 `/api/pools/...`。
   * 旧 `/api/stones/.../knowledge/...` 在后端保留兼容并加 `X-Deprecated` header。
   */
  stoneKnowledgeDirectories: (objectId: string) => `/api/pools/${encodeURIComponent(objectId)}/knowledge/directories`,
  stoneKnowledgeFiles: (objectId: string) => `/api/pools/${encodeURIComponent(objectId)}/knowledge/files`,
  /**
   * 根因 #3：frontend 不假设 backend client/index.tsx 路径，通过本 endpoint 拿权威 absPath / fsUrl。
   * stone：scope=stone；flow：scope=flow，需带 sessionId + page query。
   */
  clientSourceUrl: (scope: "stone" | "flow", objectId: string, opts?: { sessionId?: string; page?: string }) => {
    const base = `/api/objects/${scope}/${encodeURIComponent(objectId)}/client-source-url`;
    if (scope === "stone") return base;
    const params = new URLSearchParams();
    if (opts?.sessionId) params.set("sessionId", opts.sessionId);
    if (opts?.page) params.set("page", opts.page);
    const qs = params.toString();
    return qs ? `${base}?${qs}` : base;
  },
  flows: "/api/flows",
  /** collaborable § cross-object talk: 一次性 seed 一个 session（user → talk → target）。 */
  sessions: "/api/sessions",
  /** 在已存在 session 的 user.root 上追加一个新 talk_window 指向另一 object（idempotent）。 */
  addUserTalkWindow: (sessionId: string) =>
    `/api/flows/${encodeURIComponent(sessionId)}/talk-windows`,
  pauseSession: (sessionId: string) => `/api/flows/${encodeURIComponent(sessionId)}/pause`,
  resumeSession: (sessionId: string) => `/api/flows/${encodeURIComponent(sessionId)}/resume`,
  /** 列出 session 下所有 (objectId, threadId) — UI thread 切换器数据源。 */
  sessionThreads: (sessionId: string) => `/api/flows/${encodeURIComponent(sessionId)}/threads`,
  tree: "/api/tree",
  file: "/api/tree/file",
  /** 读取任意 LLM 视角的本地文件(不受 world 隔离),服务 file_window 内容预览。 */
  readAnyFile: "/api/file/read",
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
  /**
   * R0c (Agent-loop Visualizer): 列出指定 thread 下所有 loop_NNNN.{input,output,meta}.json
   * 文件,按 loopIndex 升序返回; 不携带 input/output 全文,前端 lazy 展开时再走单条 endpoint。
   */
  runtimeListLoops: (sessionId: string, objectId: string, threadId: string) =>
    `/api/runtime/flows/${encodeURIComponent(sessionId)}/objects/${encodeURIComponent(objectId)}/threads/${encodeURIComponent(threadId)}/debug/loops`,
  /** R0c: 拉取指定 loopIndex 的完整 { input, output, meta } 三元组,展开 LoopEntry 时按需调用。 */
  runtimeGetLoopDebug: (sessionId: string, objectId: string, threadId: string, loopIndex: number) =>
    `/api/runtime/flows/${encodeURIComponent(sessionId)}/objects/${encodeURIComponent(objectId)}/threads/${encodeURIComponent(threadId)}/debug/loops/${loopIndex}`,
  /**
   * R0d (Agent-loop Visualizer): 对指定 permission_ask event 做 approve / reject 决议。
   * Body 形态: { eventId?: string, action: "approve"|"reject", reason?: string }。
   * 不带 eventId 时由 backend 选择最近一条 pending; R0d 前端总是传 eventId 走精确路径。
   * 详见 docs/2026-05-25-permission-model-design.md Q0c 段。
   */
  runtimeDecidePermission: (sessionId: string, objectId: string, threadId: string) =>
    `/api/runtime/flows/${encodeURIComponent(sessionId)}/objects/${encodeURIComponent(objectId)}/threads/${encodeURIComponent(threadId)}/permission`,
  /** Stone 级 server ui_methods 调用入口。 */
  stoneCallMethod: (objectId: string) =>
    `/api/stones/${encodeURIComponent(objectId)}/call_method`,
  /** Flow object 级 server ui_methods 调用入口。 */
  flowCallMethod: (sessionId: string, objectId: string) =>
    `/api/flows/${encodeURIComponent(sessionId)}/objects/${encodeURIComponent(objectId)}/call_method`,
  /** World 级配置（站名 / 是否配置外部 skills 目录），来自 \`<baseDir>/.world.json\`。 */
  worldConfig: "/api/world/config",
};
