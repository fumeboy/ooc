import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { collectAllActions } from "../../storable/thread/process-compat.js";
import { listFlowSessions, readFlow } from "../../storable/index.js";
import type { FlowMessage, FlowStatus } from "../../shared/types/index.js";

/**
 * 根据对象的 threads.json 推断实时 Flow 状态
 */
export function inferLiveFlowStatus(objectFlowDir: string, dataStatus: FlowStatus): FlowStatus {
  const treePath = join(objectFlowDir, "threads.json");
  if (!existsSync(treePath)) return dataStatus;
  try {
    const tree = JSON.parse(readFileSync(treePath, "utf-8")) as {
      rootId?: string;
      nodes?: Record<string, { status?: string }>;
    };
    if (!tree.nodes) return dataStatus;
    for (const node of Object.values(tree.nodes)) {
      if (node.status === "running" || node.status === "waiting") {
        return "running";
      }
    }
    return dataStatus;
  } catch {
    return dataStatus;
  }
}

/** 获取 sessions 摘要列表（从顶层 flows/ 目录读取） */
export function getSessionsSummary(flowsDir: string): Array<{
  sessionId: string;
  title?: string;
  status: FlowStatus;
  firstMessage: string;
  messageCount: number;
  actionCount: number;
  hasProcess: boolean;
  createdAt: number;
  updatedAt: number;
  failureReason?: string;
}> {
  const sessionIds = listFlowSessions(flowsDir);
  const summaries: Array<{
    sessionId: string;
    title?: string;
    status: FlowStatus;
    firstMessage: string;
    messageCount: number;
    actionCount: number;
    hasProcess: boolean;
    createdAt: number;
    updatedAt: number;
    failureReason?: string;
  }> = [];

  for (const sessionId of sessionIds) {
    let flow = readFlow(join(flowsDir, sessionId, "objects", "user"));
    if (!flow) {
      const objectsDir = join(flowsDir, sessionId, "objects");
      if (existsSync(objectsDir)) {
        const entries = readdirSync(objectsDir, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          const subFlow = readFlow(join(objectsDir, entry.name));
          if (subFlow) { flow = subFlow; break; }
        }
      }
    }
    if (!flow) {
      flow = readFlow(join(flowsDir, sessionId));
    }
    if (!flow) {
      const sessionDir = join(flowsDir, sessionId);
      const sessionFile = join(sessionDir, ".session.json");
      let title = "";
      let createdAt = Date.now();
      let updatedAt = Date.now();
      try {
        const dirStat = statSync(sessionDir);
        createdAt = dirStat.birthtimeMs ? Math.floor(dirStat.birthtimeMs) : Date.now();
        updatedAt = dirStat.mtimeMs ? Math.floor(dirStat.mtimeMs) : Date.now();
      } catch { /* ignore */ }
      if (existsSync(sessionFile)) {
        try {
          const meta = JSON.parse(readFileSync(sessionFile, "utf-8"));
          if (typeof meta.title === "string") title = meta.title;
        } catch { /* ignore */ }
        try {
          const fileStat = statSync(sessionFile);
          const fileUpdatedAt = fileStat.mtimeMs ? Math.floor(fileStat.mtimeMs) : undefined;
          if (fileUpdatedAt && fileUpdatedAt > updatedAt) updatedAt = fileUpdatedAt;
        } catch { /* ignore */ }
      }

      summaries.push({
        sessionId,
        title,
        status: "running",
        firstMessage: "",
        messageCount: 0,
        actionCount: 0,
        hasProcess: false,
        createdAt,
        updatedAt,
      });
      continue;
    }

    let sessionTitle = flow.title;
    const sessionFile = join(flowsDir, sessionId, ".session.json");
    if (existsSync(sessionFile)) {
      try {
        const meta = JSON.parse(readFileSync(sessionFile, "utf-8"));
        if (typeof meta.title === "string") sessionTitle = meta.title;
      } catch { /* 忽略解析错误 */ }
    }

    const firstIn = flow.messages.find((m) => m.direction === "in" && !m.content.startsWith("[系统通知]"))
      ?? flow.messages.find((m) => m.direction === "in");
    summaries.push({
      sessionId: flow.sessionId,
      title: sessionTitle,
      status: flow.status,
      firstMessage: firstIn?.content ?? "",
      messageCount: flow.messages.length,
      actionCount: collectAllActions(flow.process.root).length,
      hasProcess: true,
      createdAt: flow.createdAt,
      updatedAt: flow.updatedAt,
      failureReason: flow.failureReason,
    });
  }

  summaries.sort((a, b) => b.updatedAt - a.updatedAt);
  return summaries;
}

/** 合并两个 Flow 的消息列表，按时间排序并去重 */
export function mergeMessages(a: FlowMessage[], b: FlowMessage[]): FlowMessage[] {
  const seen = new Set<string>();
  const all = [...a, ...b];
  const deduped: FlowMessage[] = [];

  for (const msg of all) {
    const key = `${msg.from}:${msg.to}:${msg.timestamp}:${msg.content.slice(0, 50)}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(msg);
    }
  }

  deduped.sort((x, y) => x.timestamp - y.timestamp);
  return deduped;
}
