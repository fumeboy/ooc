import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { threadStatusToFlowStatus, type TalkResult, type TalkReturn } from "./engine-types.js";

/**
 * 把 TalkResult（线程树执行产物）落盘为 data.json + 封装为 TalkReturn
 *
 * 线程树路径下 world.talk()/resumeFlow()/stepOnce() 统一通过此函数构造返回值。
 * 不再依赖 Flow 类——直接用 writeFileSync 写入 data.json（HTTP 层通过 readFlow 消费）。
 *
 * @param result - 线程树执行结果
 * @param objectName - 目标对象名
 * @param flowsDir - flows/ 根目录
 * @param incomingMessage - 本次入站消息（可选，追加到 messages[]）
 * @param fromName - 入站消息发送者（默认 "user"）
 * @param incomingTimestamp - 入站消息时间戳（可选）
 */
export function writeThreadTreeFlowData(
  result: TalkResult,
  objectName: string,
  flowsDir: string,
  incomingMessage?: string,
  fromName: string = "user",
  incomingTimestamp?: number,
): TalkReturn {
  const sessionDir = join(flowsDir, result.sessionId);
  const flowDir = join(sessionDir, "objects", objectName);
  const now = Date.now();

  /* 状态映射：ThreadStatus → FlowStatus */
  const status = threadStatusToFlowStatus(result.status);

  /* 构造 messages[] */
  const messages: TalkReturn["messages"] = [];
  if (incomingMessage) {
    messages.push({
      direction: "in",
      from: fromName,
      to: objectName,
      content: incomingMessage,
      timestamp: incomingTimestamp ?? now,
    });
  }
  if (result.summary) {
    messages.push({
      direction: "out",
      from: objectName,
      to: fromName,
      content: result.summary,
      timestamp: now,
    });
  }

  /* 落盘 data.json（供 /api/flows/:sessionId 的 readFlow 消费） */
  const flowJson: Record<string, unknown> = {
    sessionId: result.sessionId,
    stoneName: objectName,
    status,
    messages,
    process: { root: { id: "root", title: "task", status: "done", children: [] }, focusId: "root" },
    data: {},
    summary: result.summary ?? null,
    _remoteThreadId: result.threadId ?? null,
    createdAt: now,
    updatedAt: now,
  };
  if (result.failureReason) {
    flowJson.failureReason = result.failureReason;
  }

  mkdirSync(flowDir, { recursive: true });
  writeFileSync(join(flowDir, "data.json"), JSON.stringify(flowJson, null, 2), "utf-8");
  writeFileSync(join(flowDir, ".flow"), "", "utf-8");

  return {
    sessionId: result.sessionId,
    status,
    messages,
    actions: [],
    summary: result.summary,
    threadId: result.threadId,
    toJSON: () => ({ ...flowJson }),
  };
}
