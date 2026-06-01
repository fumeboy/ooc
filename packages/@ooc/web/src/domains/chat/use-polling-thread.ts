import { useCallback, useEffect, useRef, useState } from "react";
import { fetchThread } from "./query";
import type { ThreadContext } from "./model";

/**
 * 4s 静默轮询 peer thread；hash 变化时才触发 setState。
 *
 * 与 shell.tsx:209-238 的"主 thread polling"独立——shell 跟 URL 上的 active thread
 * 走（user.root 自身），UserHome 右栏选中 chat 时需要再起一份 polling 看 peer 端
 * （typically `t_user_xxx_yyy`）。
 *
 * 任一参数缺省 → 不启动定时器，返回 thread=undefined。参数变化时定时器自动重置。
 */
export function usePollingThread(
  sessionId: string | undefined,
  objectId: string | undefined,
  threadId: string | undefined,
  intervalMs = 4000,
): {
  thread: ThreadContext | undefined;
  loading: boolean;
  refresh: () => Promise<void>;
} {
  const [thread, setThread] = useState<ThreadContext | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const hashRef = useRef<string | undefined>(undefined);
  const cancelledRef = useRef(false);

  const tick = useCallback(async () => {
    if (!sessionId || !objectId || !threadId) return;
    setLoading(true);
    try {
      const next = await fetchThread(sessionId, objectId, threadId);
      if (cancelledRef.current) return;
      if (next == null) return;
      if (next.hash !== hashRef.current) {
        hashRef.current = next.hash;
        setThread(next);
      }
    } catch {
      // 静默：下一次 tick 重试
    } finally {
      if (!cancelledRef.current) setLoading(false);
    }
  }, [sessionId, objectId, threadId]);

  useEffect(() => {
    cancelledRef.current = false;
    hashRef.current = undefined;
    setThread(undefined);
    if (!sessionId || !objectId || !threadId) return () => {};
    void tick();
    const timer = window.setInterval(() => {
      void tick();
    }, intervalMs);
    return () => {
      cancelledRef.current = true;
      window.clearInterval(timer);
    };
  }, [sessionId, objectId, threadId, intervalMs, tick]);

  return { thread, loading, refresh: tick };
}
