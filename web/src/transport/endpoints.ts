export const endpoints = {
  stones: "/api/stones",
  flows: "/api/flows",
  tree: "/api/tree",
  file: "/api/tree/file",
  createFlowObject: (sessionId: string) => `/api/flows/${encodeURIComponent(sessionId)}/objects/`,
  thread: (sessionId: string, objectId: string, threadId = "root") =>
    `/api/flows/${encodeURIComponent(sessionId)}/objects/${encodeURIComponent(objectId)}/threads/${encodeURIComponent(threadId)}`,
  continueThread: (sessionId: string, objectId: string, threadId = "root") =>
    `/api/flows/${encodeURIComponent(sessionId)}/objects/${encodeURIComponent(objectId)}/threads/${encodeURIComponent(threadId)}/continue`,
  job: (jobId: string) => `/api/runtime/jobs/${encodeURIComponent(jobId)}`,
};

