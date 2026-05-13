export type CreateSessionInput = {
  sessionId: string;
  title?: string;
  objectId: string;
  initialMessage?: string;
};

export type CreatedFlowObject = {
  sessionId: string;
  objectId: string;
  initialThreadId: string;
  jobId?: string;
};

