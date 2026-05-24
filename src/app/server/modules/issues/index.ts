import { Elysia } from "elysia";
import { findIssueSubscribers, issuesService } from "@src/persistable";
import { notifyThreadActivated } from "@src/observable";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import type { ServerConfig } from "../../bootstrap/config";
import { AppServerError } from "../../bootstrap/errors";
import {
  appendCommentBody,
  createIssueBody,
  issueIdParams,
  sessionIdParams,
} from "./model";

/**
 * Issue #6 Bad #1: session 存在性前置校验。在所有 per-session issue 接口
 * 之前调用,缺失 session → 404 NOT_FOUND;避免 listIssues 对不存在 session
 * 静默返回空数组,无法和"session 存在但没 issue"区分。
 */
async function ensureSessionExists(baseDir: string, sessionId: string): Promise<void> {
  const sDir = join(baseDir, "flows", sessionId);
  try {
    const stats = await stat(sDir);
    if (!stats.isDirectory()) {
      throw new AppServerError("NOT_FOUND", `session '${sessionId}' is not a directory`, { sessionId });
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new AppServerError("NOT_FOUND", `session '${sessionId}' does not exist`, { sessionId });
    }
    throw error;
  }
}

/**
 * Issues HTTP module — Tier A 暴露面。
 *
 * 5 个 endpoint(create / list / get / append-comment / close);所有业务逻辑
 * 委托给 `persistable.issuesService`。本模块只做 Elysia 路由 + schema 校验 +
 * authorKind 服务端派生(S3 fix:不接受 client 传 authorKind)。
 */
export function issuesModule(config: Pick<ServerConfig, "baseDir">) {
  const baseDir = config.baseDir;

  return new Elysia({ prefix: "/api", name: "ooc.issues" })
    // POST /api/flows/:sessionId/issues — 创建 Issue
    .post(
      "/flows/:sessionId/issues",
      async ({ params, body }) => {
        await ensureSessionExists(baseDir, params.sessionId);
        try {
          const issue = await issuesService.createIssue({
            baseDir,
            sessionId: params.sessionId,
            title: body.title,
            description: body.description,
            createdByObjectId: body.createdByObjectId,
          });
          return { issue };
        } catch (err) {
          throw new AppServerError("INVALID_INPUT", (err as Error).message);
        }
      },
      { params: sessionIdParams, body: createIssueBody },
    )

    // GET /api/flows/:sessionId/issues — 列出 session 内所有 Issue 摘要
    .get(
      "/flows/:sessionId/issues",
      async ({ params }) => {
        await ensureSessionExists(baseDir, params.sessionId);
        const issues = await issuesService.listIssues({ baseDir, sessionId: params.sessionId });
        return { issues };
      },
      { params: sessionIdParams },
    )

    // GET /api/flows/:sessionId/issues/:id — 获取单个 Issue 完整内容
    .get(
      "/flows/:sessionId/issues/:id",
      async ({ params }) => {
        await ensureSessionExists(baseDir, params.sessionId);
        const issue = await issuesService.getIssue({
          baseDir,
          sessionId: params.sessionId,
          issueId: params.id,
        });
        if (!issue) throw new AppServerError("NOT_FOUND", `Issue #${params.id} not found`);
        return { issue };
      },
      { params: issueIdParams },
    )

    // POST /api/flows/:sessionId/issues/:id/comments — 追加评论
    .post(
      "/flows/:sessionId/issues/:id/comments",
      async ({ params, body }) => {
        await ensureSessionExists(baseDir, params.sessionId);
        try {
          const result = await issuesService.appendComment({
            baseDir,
            sessionId: params.sessionId,
            issueId: params.id,
            text: body.text,
            authorObjectId: body.authorObjectId,
            // S3:authorKind 服务端派生为 "user"(HTTP 路径默认值);不接受 client 传
            authorKind: "user",
            mentions: body.mentions,
          });
          // 根因 #5：事件源 enqueue。把订阅本 Issue 的所有 thread 入队,
          // 跳过作者自身 thread(author 无 thread context 在 HTTP 路径上 ——
          // 用 exceptObjectId 排除作者 object)。
          const subscribers = await findIssueSubscribers(
            baseDir,
            params.sessionId,
            params.id,
            { exceptObjectId: body.authorObjectId },
          );
          for (const ref of subscribers) {
            notifyThreadActivated({
              sessionId: ref.sessionId,
              objectId: ref.objectId,
              threadId: ref.threadId,
            });
          }
          return result;
        } catch (err) {
          throw new AppServerError("INVALID_INPUT", (err as Error).message);
        }
      },
      { params: issueIdParams, body: appendCommentBody },
    )

    // POST /api/flows/:sessionId/issues/:id/close — 关闭 Issue
    .post(
      "/flows/:sessionId/issues/:id/close",
      async ({ params }) => {
        await ensureSessionExists(baseDir, params.sessionId);
        try {
          // R3 #17:closeIssue 返回 { issue, noop };把 noop 直接透传出去,
          // 让 caller 区分"刚 closed"vs"本就 closed"
          const result = await issuesService.closeIssue({
            baseDir,
            sessionId: params.sessionId,
            issueId: params.id,
          });
          return { issue: result.issue, noop: result.noop };
        } catch (err) {
          throw new AppServerError("INVALID_INPUT", (err as Error).message);
        }
      },
      { params: issueIdParams },
    );
}
