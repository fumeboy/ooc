export type FlowSession = {
  sessionId: string;
  title: string;
  dir: string;
  createdAt: number;
  updatedAt: number;
  paused?: boolean;
};
