/**
 * SSE 连接 hook —— 监听后端实时事件
 *
 * @ref docs/哲学文档/gene.md#G11 — references — SSE 驱动前端实时更新
 * @ref src/server/events.ts — references — 后端 SSE 事件类型
 */
import { useEffect, useRef } from "react";
import { useSetAtom, useAtomValue } from "jotai";
import { sseConnectedAtom, lastFlowEventAtom, streamingThoughtAtom, streamingTalkAtom, streamingProgramAtom, streamingActionAtom, streamingStackPushAtom, streamingStackPopAtom, streamingSetPlanAtom, userSessionsAtom } from "../store/session";
import { activeSessionIdAtom } from "../store/session";
import { objectsAtom } from "../store/objects";
import { flowProgressAtom } from "../store/progress";
import { connectSSE, fetchObjects, fetchSessions } from "../api/client";

/**
 * SSE 连接 hook
 *
 * 监听后端事件，自动刷新相关数据。
 * 处理流式 thinking/talk 事件，实时更新 streaming atoms。
 */
export function useSSE() {
  const setConnected = useSetAtom(sseConnectedAtom);
  const setObjects = useSetAtom(objectsAtom);
  const setSessions = useSetAtom(userSessionsAtom);
  const setLastFlowEvent = useSetAtom(lastFlowEventAtom);
  const setStreamingThought = useSetAtom(streamingThoughtAtom);
  const setStreamingTalk = useSetAtom(streamingTalkAtom);
  const setStreamingProgram = useSetAtom(streamingProgramAtom);
  const setStreamingAction = useSetAtom(streamingActionAtom);
  const setStreamingStackPush = useSetAtom(streamingStackPushAtom);
  const setStreamingStackPop = useSetAtom(streamingStackPopAtom);
  const setStreamingSetPlan = useSetAtom(streamingSetPlanAtom);
  const setFlowProgress = useSetAtom(flowProgressAtom);
  const activeSessionId = useAtomValue(activeSessionIdAtom);
  const activeSessionIdRef = useRef(activeSessionId);
  activeSessionIdRef.current = activeSessionId;

  /* StrictMode 防御：缓存当前活跃的 disconnect 句柄
   *
   * React StrictMode dev 双 mount 会跑两次 effect。原实现每次都新建 EventSource，
   * 即使 cleanup 关旧的，也存在微秒级竞态窗口（短时间双连接、双倍事件）。
   *
   * 用 ref 跟踪：进入 effect 前先关掉上一次还活着的连接，再建新的。
   * cleanup 时仅当 ref 仍指向自己时才执行关闭——避免 StrictMode 第二次 mount
   * 关掉自己刚建好的连接。 */
  const sseDisconnectRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    /* 严格防御：进入前若有活跃连接，先关闭 */
    if (sseDisconnectRef.current) {
      sseDisconnectRef.current();
      sseDisconnectRef.current = null;
    }


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

    let myDisconnect: (() => void) | null = null;

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
            prev?.sessionId === event.sessionId ? null : prev,
          );
          break;

        case "flow:progress":
          /* 只跟踪当前活跃 session 的入口 Flow 进度（通过 ref 读取，避免 SSE 重连） */
          if (event.sessionId === activeSessionIdRef.current) {
            setFlowProgress({
              objectName: event.objectName,
              sessionId: event.sessionId,
              iterations: event.iterations,
              maxIterations: event.maxIterations,
              totalIterations: event.totalIterations,
              maxTotalIterations: event.maxTotalIterations,
            });
          }
          break;

        /* 流式 thought chunk：来自 provider 原生 thinking，而非 assistant 输出协议 */
        case "stream:thought":
          setStreamingThought((prev) =>
            prev?.sessionId === event.sessionId
              ? { ...prev, content: prev.content + event.chunk }
              : { sessionId: event.sessionId, content: event.chunk },
          );
          break;

        /* 流式 program chunk */
        case "stream:program":
          setStreamingProgram((prev) => {
            if (prev?.sessionId === event.sessionId) {
              return { ...prev, content: prev.content + event.chunk };
            }
            const result: { sessionId: string; content: string; lang?: "javascript" | "shell" } = {
              sessionId: event.sessionId,
              content: event.chunk,
            };
            if (event.lang) {
              result.lang = event.lang;
            }
            return result;
          });
          break;

        /* 流式 thought 结束：provider thinking 通道本轮完成 */
        case "stream:thought:end":
          setStreamingThought((prev) =>
            prev?.sessionId === event.sessionId ? null : prev,
          );
          break;

        /* 流式 program 结束 */
        case "stream:program:end":
          setStreamingProgram((prev) =>
            prev?.sessionId === event.sessionId ? null : prev,
          );
          break;

        /* 流式 talk chunk */
        case "stream:talk":
          setStreamingTalk((prev) =>
            prev?.sessionId === event.sessionId && prev.target === event.target
              ? { ...prev, content: prev.content + event.chunk }
              : { sessionId: event.sessionId, target: event.target, from: event.objectName, content: event.chunk },
          );
          break;

        /* 流式 action chunk */
        case "stream:action":
          setStreamingAction((prev) =>
            prev?.sessionId === event.sessionId && prev.toolName === event.toolName
              ? { ...prev, content: prev.content + event.chunk }
              : { sessionId: event.sessionId, toolName: event.toolName, content: event.chunk },
          );
          break;

        /* 流式 talk 结束 — 不立即清除，等 flow:message 到达后由 ChatPage 清除
         * 避免 StreamingBubble 消失和正式消息出现之间的空窗期 */
        case "stream:talk:end":
          /* 标记为已结束但保留内容，ChatPage 收到 flow:message 后清除 */
          setStreamingTalk((prev) =>
            prev?.sessionId === event.sessionId && prev.target === event.target
              ? { ...prev, ended: true } as any
              : prev,
          );
          break;

        /* 流式 action 结束 */
        case "stream:action:end":
          setStreamingAction((prev) =>
            prev?.sessionId === event.sessionId && prev.toolName === event.toolName
              ? null
              : prev,
          );
          break;

        /* 流式 stack_push chunk */
        case "stream:stack_push":
          setStreamingStackPush((prev) =>
            prev?.sessionId === event.sessionId && prev.opType === event.opType && prev.attr === event.attr
              ? { ...prev, content: prev.content + event.chunk }
              : { sessionId: event.sessionId, opType: event.opType, attr: event.attr, content: event.chunk },
          );
          break;

        /* 流式 stack_push 结束 */
        case "stream:stack_push:end":
          setStreamingStackPush((prev) =>
            prev?.sessionId === event.sessionId && prev.opType === event.opType && prev.attr === event.attr
              ? null
              : prev,
          );
          break;

        /* 流式 stack_pop chunk */
        case "stream:stack_pop":
          setStreamingStackPop((prev) =>
            prev?.sessionId === event.sessionId && prev.opType === event.opType && prev.attr === event.attr
              ? { ...prev, content: prev.content + event.chunk }
              : { sessionId: event.sessionId, opType: event.opType, attr: event.attr, content: event.chunk },
          );
          break;

        /* 流式 stack_pop 结束 */
        case "stream:stack_pop:end":
          setStreamingStackPop((prev) =>
            prev?.sessionId === event.sessionId && prev.opType === event.opType && prev.attr === event.attr
              ? null
              : prev,
          );
          break;

        /* 流式 set_plan chunk */
        case "stream:set_plan":
          setStreamingSetPlan((prev) =>
            prev?.sessionId === event.sessionId
              ? { ...prev, content: prev.content + event.chunk }
              : { sessionId: event.sessionId, content: event.chunk },
          );
          break;

        /* 流式 set_plan 结束 */
        case "stream:set_plan:end":
          setStreamingSetPlan((prev) =>
            prev?.sessionId === event.sessionId ? null : prev,
          );
          break;
      }
    });

    myDisconnect = disconnect;
    sseDisconnectRef.current = disconnect;

    return () => {
      /* 仅当 ref 还指向本次 effect 建立的连接时才关——避免 StrictMode 第二次 mount
       * 时关掉新连接（第一次 cleanup 跑在第二次 setup 之后） */
      if (sseDisconnectRef.current === myDisconnect) {
        sseDisconnectRef.current = null;
      }
      disconnect();
      setConnected(false);
    };
    /* 依赖故意只填 setAtom 函数（jotai 保证稳定 ref）；activeSessionId 通过 ref 读，
     * 避免 sid 变化时重连（重连会丢失中途事件） */
  }, [setConnected, setObjects, setSessions, setLastFlowEvent, setStreamingThought, setStreamingTalk, setStreamingProgram, setStreamingAction, setStreamingStackPush, setStreamingStackPop, setStreamingSetPlan, setFlowProgress]);
}
