/**
 * SSE 连接 hook —— 监听后端实时事件
 *
 * @ref .ooc/docs/哲学文档/gene.md#G11 — references — SSE 驱动前端实时更新
 * @ref src/server/events.ts — references — 后端 SSE 事件类型
 */
import { useEffect } from "react";
import { useSetAtom } from "jotai";
import { sseConnectedAtom, lastFlowEventAtom, streamingThoughtAtom, streamingTalkAtom } from "../store/session";
import { objectsAtom } from "../store/objects";
import { connectSSE, fetchObjects } from "../api/client";

/**
 * SSE 连接 hook
 *
 * 监听后端事件，自动刷新相关数据。
 * 处理流式 thought/talk 事件，实时更新 streaming atoms。
 */
export function useSSE() {
  const setConnected = useSetAtom(sseConnectedAtom);
  const setObjects = useSetAtom(objectsAtom);
  const setLastFlowEvent = useSetAtom(lastFlowEventAtom);
  const setStreamingThought = useSetAtom(streamingThoughtAtom);
  const setStreamingTalk = useSetAtom(streamingTalkAtom);

  useEffect(() => {
    /* 防止并发 fetchObjects 竞争：只应用最新请求的结果 */
    let objectsFetchId = 0;
    const refreshObjects = () => {
      const id = ++objectsFetchId;
      fetchObjects().then((data) => {
        if (id === objectsFetchId) setObjects(data);
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
        case "flow:end":
        case "flow:status":
        case "flow:action":
        case "flow:message":
          /* 推送到全局 atom，组件自行订阅 */
          setLastFlowEvent(event);
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
  }, [setConnected, setObjects, setLastFlowEvent, setStreamingThought, setStreamingTalk]);
}
