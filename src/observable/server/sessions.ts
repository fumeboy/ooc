import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { collectAllEvents } from "../../storable/thread/process-compat.js";
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
    let sawWaiting = false;
    for (const node of Object.values(tree.nodes)) {
      if (node.status === "running") return "running";
      if (node.status === "waiting") sawWaiting = true;
    }
    if (sawWaiting) return "waiting";
    return dataStatus;
  } catch {
    return dataStatus;
  }
}

export function aggregateFlowStatuses(statuses: FlowStatus[], fallbackStatus: FlowStatus): FlowStatus {
  if (statuses.includes("running")) return "running";
  if (statuses.includes("waiting")) return "waiting";
  if (statuses.includes("pausing")) return "pausing";
  if (statuses.includes("failed")) return "failed";
  if (statuses.includes("finished")) return "finished";
  return fallbackStatus;
}

/**
 * 聚合同一 session 下所有对象的实时状态。
 *
 * 详情接口会展示每个 subFlow 的实时状态；列表摘要也必须使用同一套来源，
 * 否则旧数据里第一个对象已 finished、另一个对象仍 running 时会出现
 * "列表 finished / 详情思考中" 的矛盾。
 */
export function inferSessionLiveStatus(sessionDir: string, fallbackStatus: FlowStatus): FlowStatus {
  const objectsDir = join(sessionDir, "objects");
  if (!existsSync(objectsDir)) return fallbackStatus;

  const statuses: FlowStatus[] = [];

  try {
    const entries = readdirSync(objectsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const objectFlowDir = join(objectsDir, entry.name);
      const subFlow = readFlow(objectFlowDir);
      const baseStatus = subFlow?.status ?? (existsSync(join(objectFlowDir, "threads.json")) ? "running" : fallbackStatus);
      const liveStatus = inferLiveFlowStatus(objectFlowDir, baseStatus);
      statuses.push(liveStatus);
    }
  } catch {
    return fallbackStatus;
  }

  return aggregateFlowStatuses(statuses, fallbackStatus);
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
      status: inferSessionLiveStatus(join(flowsDir, sessionId), flow.status),
      firstMessage: firstIn?.content ?? "",
      messageCount: flow.messages.length,
      actionCount: collectAllEvents(flow.process.root).length,
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
