/**
 * SSE 连接 hook —— 监听后端实时事件
 *
 * @ref docs/哲学文档/gene.md#G11 — references — SSE 驱动前端实时更新
 * @ref src/server/events.ts — references — 后端 SSE 事件类型
 */
import { useEffect, useRef } from "react";
import { useSetAtom, useAtomValue } from "jotai";
import { sseConnectedAtom, lastFlowEventAtom, streamingThoughtAtom, streamingTalkAtom, userSessionsAtom } from "../store/session";
import { activeSessionIdAtom } from "../store/session";
import { objectsAtom } from "../store/objects";
import { flowProgressAtom } from "../store/progress";
import { connectSSE, fetchObjects, fetchSessions } from "../api/client";

/**
 * SSE 连接 hook
 *
 * 监听后端事件，自动刷新相关数据。
 * 处理流式 thought/talk 事件，实时更新 streaming atoms。
 */
export function useSSE() {
  const setConnected = useSetAtom(sseConnectedAtom);
  const setObjects = useSetAtom(objectsAtom);
  const setSessions = useSetAtom(userSessionsAtom);
  const setLastFlowEvent = useSetAtom(lastFlowEventAtom);
  const setStreamingThought = useSetAtom(streamingThoughtAtom);
  const setStreamingTalk = useSetAtom(streamingTalkAtom);
  const setFlowProgress = useSetAtom(flowProgressAtom);
  const activeSessionId = useAtomValue(activeSessionIdAtom);
  const activeSessionIdRef = useRef(activeSessionId);
  activeSessionIdRef.current = activeSessionId;

  useEffect(() => {
    /* 防止并发 fetchObjects 竞争：只应用最新请求的结果 */
    let objectsFetchId = 0;
    const refreshObjects = () => {
      const id = ++objectsFetchId;
      fetchObjects().then((data) => {
        if (id === objectsFetchId) setObjects(data);
      }).catch(console.error);
    };

    /* 防止并发 fetchSessions 竞争 */
    let sessionsFetchId = 0;
    const refreshSessions = () => {
      const id = ++sessionsFetchId;
      fetchSessions().then((data) => {
        if (id === sessionsFetchId) setSessions(data);
      }).catch(console.error);
    };

    const disconnect = connectSSE((event) => {
      switch (event.type) {
        case "object:updated":
          if (event.name === "_connected") {
            setConnected(true);
            break;
          }
          /* 对象更新时刷新列表 */
          refreshObjects();
          break;
        case "object:created":
          refreshObjects();
          break;
        case "flow:start":
          setLastFlowEvent(event);
          /* 新 flow 开始时刷新 sessions 列表（用于 Welcome 页创建新 session 后刷新侧边栏） */
          refreshSessions();
          break;
        case "flow:status":
        case "flow:action":
        case "flow:message":
          setLastFlowEvent(event);
          break;
        case "flow:end":
          setLastFlowEvent(event);
          /* flow 结束时也刷新 sessions 列表（更新状态） */
          refreshSessions();
          /* 清空进度（仅匹配当前跟踪的 Flow） */
          setFlowProgress((prev) =>
            prev?.taskId === event.taskId ? null : prev,
          );
          break;

        case "flow:progress":
          /* 只跟踪当前活跃 session 的入口 Flow 进度（通过 ref 读取，避免 SSE 重连） */
          if (event.taskId === activeSessionIdRef.current) {
            setFlowProgress({
              objectName: event.objectName,
              taskId: event.taskId,
              iterations: event.iterations,
              maxIterations: event.maxIterations,
              totalIterations: event.totalIterations,
              maxTotalIterations: event.maxTotalIterations,
            });
          }
          break;

        /* 流式 thought chunk */
        case "stream:thought":
          setStreamingThought((prev) =>
            prev?.taskId === event.taskId
              ? { ...prev, content: prev.content + event.chunk }
              : { taskId: event.taskId, content: event.chunk },
          );
          break;

        /* 流式 thought 结束 */
        case "stream:thought:end":
          setStreamingThought((prev) =>
            prev?.taskId === event.taskId ? null : prev,
          );
          break;

        /* 流式 talk chunk */
        case "stream:talk":
          setStreamingTalk((prev) =>
            prev?.taskId === event.taskId && prev.target === event.target
              ? { ...prev, content: prev.content + event.chunk }
              : { taskId: event.taskId, target: event.target, from: event.objectName, content: event.chunk },
          );
          break;

        /* 流式 talk 结束 — 不立即清除，等 flow:message 到达后由 ChatPage 清除
         * 避免 StreamingBubble 消失和正式消息出现之间的空窗期 */
        case "stream:talk:end":
          /* 标记为已结束但保留内容，ChatPage 收到 flow:message 后清除 */
          setStreamingTalk((prev) =>
            prev?.taskId === event.taskId && prev.target === event.target
              ? { ...prev, ended: true } as any
              : prev,
          );
          break;
      }
    });

    return () => {
      disconnect();
      setConnected(false);
    };
  }, [setConnected, setObjects, setSessions, setLastFlowEvent, setStreamingThought, setStreamingTalk, setFlowProgress]);
}
