export type CreateSessionInput = {
  sessionId: string;
  title?: string;
  targetObjectId: string;
  initialMessage: string;
};

/** ooc-3 adapted: no userThreadId/talkWindowId; jobId = threadId */
export type CreatedSession = {
  sessionId: string;
  userThreadId: string;
  talkWindowId: string;
  targetObjectId: string;
  targetThreadId: string;
  jobId: string;
};
