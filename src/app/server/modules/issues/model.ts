import { t } from "elysia";

/**
 * 严格 schema:防止 path-traversal / 非法字符直接进 service / file path(S1 fix)。
 *
 * sessionId / issueId 都会拼到 `flows/{sid}/issues/issue-{id}.json` 文件路径,
 * 任何 percent-encoded 或 `..` 都不允许 — `src/persistable/issue.ts:issueFile`
 * 入口也有同样校验作为深度防御。
 */
export const sessionIdParams = t.Object({
  sessionId: t.String({ pattern: "^[a-zA-Z0-9_-]{1,64}$" }),
});

export const issueIdParams = t.Object({
  sessionId: t.String({ pattern: "^[a-zA-Z0-9_-]{1,64}$" }),
  id: t.Numeric({ minimum: 1 }),
});

/** Issue 创建 body;S3:authorObjectId 必须 stones/ 下存在(service 层做校验)。 */
export const createIssueBody = t.Object({
  title: t.String({ minLength: 1, maxLength: 200 }),
  description: t.Optional(t.String({ maxLength: 8192 })),
  createdByObjectId: t.String({ pattern: "^[a-zA-Z][a-zA-Z0-9_-]{0,63}$" }),
});

/**
 * Comment append body;authorKind 由 server 派生(HTTP=user / LLM=llm),
 * 不接受 client 传(S3 fix)。
 */
export const appendCommentBody = t.Object({
  text: t.String({ minLength: 1, maxLength: 4096 }),
  authorObjectId: t.String({ pattern: "^[a-zA-Z][a-zA-Z0-9_-]{0,63}$" }),
  mentions: t.Optional(t.Array(t.String({ pattern: "^[a-zA-Z][a-zA-Z0-9_-]{0,63}$" }))),
});
