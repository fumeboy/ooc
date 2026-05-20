import { useEffect, useState } from "react";
import { endpoints } from "../../transport/endpoints";
import { messageFromError } from "../../transport/errors";
import { requestJson } from "../../transport/http";
import type { Issue, IssueSummary } from "./model";

/**
 * 直接调用后端 `GET /api/flows/<sid>/issues`。返回包含 `issues: IssueSummary[]`。
 */
export function fetchIssues(sessionId: string) {
  return requestJson<{ issues: IssueSummary[] }>(endpoints.flowIssues(sessionId));
}

/**
 * 拉取单个 Issue 完整对象(含 comments[]) — `GET /api/flows/<sid>/issues/<id>`。
 */
export function fetchIssue(sessionId: string, issueId: number | string) {
  return requestJson<{ issue: Issue }>(endpoints.flowIssue(sessionId, issueId));
}

/**
 * `useIssues(sessionId)` — sidebar 展开 issues 节点时取列表。
 *
 * 跟随项目现有"组件内部 useEffect + setState"的极简 hook 范式
 * (参考 `domains/sessions/query.ts` / `domains/flows/query.ts`),
 * 不引入 react-query / swr。轻量轮询: 5 秒 refetch 一次, 配合 sidebar
 * 即时反映新增 issue / 评论数变化。sessionId 变化时重新订阅。
 */
export function useIssues(sessionId: string | undefined): { issues: IssueSummary[]; loading: boolean } {
  const [issues, setIssues] = useState<IssueSummary[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!sessionId) {
      setIssues([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const load = async () => {
      try {
        const res = await fetchIssues(sessionId);
        if (!cancelled) setIssues(res.issues);
      } catch {
        // 取列表失败不阻塞 sidebar; 下一次 tick 再试。
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    const timer = window.setInterval(() => { void load(); }, 5000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [sessionId]);

  return { issues, loading };
}

/**
 * `useIssue(sessionId, issueId)` — IssueDetailView 数据源。
 *
 * 与 useIssues 同范式: useEffect + setState; 5 秒轻量轮询让 detail 视图反映
 * 新增 comment / status 变化。`refresh()` 暴露给上层"手动刷新"按钮(MainPanel
 * breadcrumb 的 ↻)。
 *
 * fetch 失败显式抛 `error` 字符串,UI 渲染 error 态而不是空白 panel。
 */
export function useIssue(
  sessionId: string | undefined,
  issueId: number | string | undefined,
): { issue: Issue | undefined; loading: boolean; error: string | undefined; refresh: () => void } {
  const [issue, setIssue] = useState<Issue | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!sessionId || issueId === undefined || issueId === "") {
      setIssue(undefined);
      setError(undefined);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const load = async () => {
      try {
        const res = await fetchIssue(sessionId, issueId);
        if (!cancelled) {
          setIssue(res.issue);
          setError(undefined);
        }
      } catch (e) {
        if (!cancelled) setError(messageFromError(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    const timer = window.setInterval(() => { void load(); }, 5000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [sessionId, issueId, tick]);

  return { issue, loading, error, refresh: () => setTick((n) => n + 1) };
}
