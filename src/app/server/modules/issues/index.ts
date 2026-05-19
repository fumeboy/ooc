import { Elysia } from "elysia";
import { issuesService } from "@src/persistable";
import type { ServerConfig } from "../../bootstrap/config";
import { AppServerError } from "../../bootstrap/errors";
import {
  appendCommentBody,
  createIssueBody,
  issueIdParams,
  sessionIdParams,
} from "./model";

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
        const issues = await issuesService.listIssues({ baseDir, sessionId: params.sessionId });
        return { issues };
      },
      { params: sessionIdParams },
    )

    // GET /api/flows/:sessionId/issues/:id — 获取单个 Issue 完整内容
    .get(
      "/flows/:sessionId/issues/:id",
      async ({ params }) => {
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
        try {
          const issue = await issuesService.closeIssue({
            baseDir,
            sessionId: params.sessionId,
            issueId: params.id,
          });
          return { issue };
        } catch (err) {
          throw new AppServerError("INVALID_INPUT", (err as Error).message);
        }
      },
      { params: issueIdParams },
    );
}
