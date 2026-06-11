/**
 * collaborable cross-object talk：
 * 创建 session 现在等价于 user 对 target object 的初次 talk。
 *
 * - sessionId / title：session 元信息
 * - targetObjectId：目标 flow object（"user" 不允许，会被后端拒绝）
 * - initialMessage：必填；user 的第一条消息
 */
export type CreateSessionInput = {
  sessionId: string;
  title?: string;
  targetObjectId: string;
  initialMessage: string;
};

/** seedSession 的响应；callee thread 默认是 web 上要展示的活跃 thread。 */
export type CreatedSession = {
  sessionId: string;
  userThreadId: string;
  talkWindowId: string;
  targetObjectId: string;
  targetThreadId: string;
  jobId: string;
};
