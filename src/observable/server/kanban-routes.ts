import { existsSync } from "node:fs";
import { join } from "node:path";
import type { World } from "../../world/index.js";
import { errorResponse, json } from "./responses.js";

/** 处理 Session Issues / Tasks 看板相关 HTTP 路由 */
export async function handleKanbanRoute(
  method: string,
  path: string,
  req: Request,
  world: World,
): Promise<Response | null> {
  const createIssueMatch = path.match(/^\/api\/sessions\/([^/]+)\/issues$/);
  if (method === "POST" && createIssueMatch) {
    const [, sessionId] = createIssueMatch;
    const body = (await req.json()) as { title?: string; description?: string; participants?: string[] };
    if (!body.title) return errorResponse("title is required");

    const sessionDir = join(world.flowsDir, sessionId!);
    const { createIssue } = await import("../../collaborable/kanban/methods.js");
    const issue = await createIssue(sessionDir, body.title, body.description, body.participants);
    return json({ success: true, data: issue });
  }

  const createTaskMatch = path.match(/^\/api\/sessions\/([^/]+)\/tasks$/);
  if (method === "POST" && createTaskMatch) {
    const [, sessionId] = createTaskMatch;
    const body = (await req.json()) as { title?: string; description?: string; issueRefs?: string[] };
    if (!body.title) return errorResponse("title is required");

    const sessionDir = join(world.flowsDir, sessionId!);
    const { createTask } = await import("../../collaborable/kanban/methods.js");
    const task = await createTask(sessionDir, body.title, body.description, body.issueRefs);
    return json({ success: true, data: task });
  }

  const issueCommentMatch = path.match(/^\/api\/sessions\/([^/]+)\/issues\/([^/]+)\/comments$/);
  if (method === "POST" && issueCommentMatch) {
    const [, sessionId, issueId] = issueCommentMatch;
    const body = (await req.json()) as { content?: string; mentions?: string[] };
    if (!body.content) return errorResponse("content is required");

    const sessionDir = join(world.flowsDir, sessionId!);
    const { commentOnIssue } = await import("../../collaborable/kanban/discussion.js");
    const result = await commentOnIssue(sessionDir, issueId!, "user", body.content, body.mentions);
    return json({ success: true, data: result.comment });
  }

  const issueAckMatch = path.match(/^\/api\/sessions\/([^/]+)\/issues\/([^/]+)\/ack$/);
  if (method === "POST" && issueAckMatch) {
    const [, sessionId, issueId] = issueAckMatch;
    const sessionDir = join(world.flowsDir, sessionId!);
    const { setIssueNewInfo } = await import("../../collaborable/kanban/methods.js");
    await setIssueNewInfo(sessionDir, issueId!, false);
    return json({ success: true });
  }

  const taskAckMatch = path.match(/^\/api\/sessions\/([^/]+)\/tasks\/([^/]+)\/ack$/);
  if (method === "POST" && taskAckMatch) {
    const [, sessionId, taskItemId] = taskAckMatch;
    const sessionDir = join(world.flowsDir, sessionId!);
    const { setTaskNewInfo } = await import("../../collaborable/kanban/methods.js");
    await setTaskNewInfo(sessionDir, taskItemId!, false);
    return json({ success: true });
  }

  const issueStatusMatch = path.match(/^\/api\/sessions\/([^/]+)\/issues\/([^/]+)\/status$/);
  if (method === "POST" && issueStatusMatch) {
    const [, sessionId, issueId] = issueStatusMatch;
    const body = (await req.json()) as { status?: string };
    const status = body.status;
    const validIssueStatus = new Set([
      "discussing", "designing", "reviewing",
      "executing", "confirming", "done", "closed",
    ]);
    if (!status || !validIssueStatus.has(status)) {
      return errorResponse(
        `非法 status："${status ?? ""}"；合法值为 ${[...validIssueStatus].join(",")}`,
      );
    }
    const sessionDir = join(world.flowsDir, sessionId!);
    if (!existsSync(sessionDir)) return errorResponse(`Session "${sessionId}" 不存在`, 404);
    const { updateIssueStatus } = await import("../../collaborable/kanban/methods.js");
    const { readIssueDetail } = await import("../../collaborable/kanban/store.js");
    try {
      await updateIssueStatus(sessionDir, issueId!, status as import("../../collaborable/kanban/types.js").IssueStatus);
    } catch (e) {
      return errorResponse((e as Error).message, 404);
    }
    const issue = await readIssueDetail(sessionDir, issueId!);
    return json({ success: true, data: issue });
  }

  const taskStatusMatch = path.match(/^\/api\/sessions\/([^/]+)\/tasks\/([^/]+)\/status$/);
  if (method === "POST" && taskStatusMatch) {
    const [, sessionId, taskId] = taskStatusMatch;
    const body = (await req.json()) as { status?: string };
    const status = body.status;
    const validTaskStatus = new Set(["running", "done", "closed"]);
    if (!status || !validTaskStatus.has(status)) {
      return errorResponse(
        `非法 status："${status ?? ""}"；合法值为 ${[...validTaskStatus].join(",")}`,
      );
    }
    const sessionDir = join(world.flowsDir, sessionId!);
    if (!existsSync(sessionDir)) return errorResponse(`Session "${sessionId}" 不存在`, 404);
    const { updateTaskStatus } = await import("../../collaborable/kanban/methods.js");
    const { readTaskDetail } = await import("../../collaborable/kanban/store.js");
    try {
      await updateTaskStatus(sessionDir, taskId!, status as import("../../collaborable/kanban/types.js").TaskStatus);
    } catch (e) {
      return errorResponse((e as Error).message, 404);
    }
    const task = await readTaskDetail(sessionDir, taskId!);
    return json({ success: true, data: task });
  }

  return null;
}
