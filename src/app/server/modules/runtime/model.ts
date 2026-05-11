import { t } from "elysia";

export const threadDebugParams = t.Object({
  sessionId: t.String(),
  objectId: t.String(),
  threadId: t.String(),
});

export const loopDebugParams = t.Object({
  sessionId: t.String(),
  objectId: t.String(),
  threadId: t.String(),
  loopIndex: t.Numeric(),
});

export const RuntimeModel = {
  globalPauseResponse: t.Object({ enabled: t.Boolean() }),
  llmConfigResponse: t.Object({
    configured: t.Boolean(),
    provider: t.String(),
    baseUrl: t.String(),
    model: t.String(),
    error: t.Optional(t.String()),
  }),
} as const;
