/**
 * useHashRouter — Hash 路由双向同步 hook
 *
 * atoms → hash：监听 atoms 变化，更新 location.hash
 * hash → atoms：监听 hashchange 事件，解析 hash 更新 atoms
 *
 * 路由格式：
 *   /#/                                    → Welcome 页面
 *   /#/flows/{sessionId}                   → Session Kanban
 *   /#/flows/{sessionId}/objects/{name}    → FlowView
 *   /#/flows/{sessionId}/issues/{id}       → IssueDetailView
 *   /#/flows/{sessionId}/tasks/{id}        → TaskDetailView
 *   /#/stones/{name}                       → ObjectDetail
 *   /#/stones/{name}/reflect               → ReflectFlowView
 *   /#/stones                              → Stones tab
 *   /#/world                               → World tab
 */
import { useEffect, useRef } from "react";
import { useAtom, useSetAtom } from "jotai";
import {
  activeTabAtom,
  activeSessionIdAtom,
  activeSessionFlowAtom,
  activeFilePathAtom,
  editorTabsAtom,
} from "../store/session";
import { viewRegistry } from "../router";

/** 从 hash 中提取路径（去掉 #/ 前缀） */
function parseHash(): string {
  return location.hash.replace(/^#\/?/, "");
}

/** 从路径中提取 sessionId */
function extractSessionId(path: string): string | null {
  const m = path.match(/^flows\/([^/]+)/);
  return m ? m[1]! : null;
}

/** 根据 atoms 状态计算目标 hash */
function computeHash(activeTab: string, activePath: string | null): string {
  if (activePath) return "/" + activePath;
  if (activeTab === "stones") return "/stones";
  if (activeTab === "world") return "/world";
  return "/";
}

export function useHashRouter() {
  const [activeTab, setActiveTab] = useAtom(activeTabAtom);
  const [activeId, setActiveId] = useAtom(activeSessionIdAtom);
  const [activePath, setActivePath] = useAtom(activeFilePathAtom);
  const setActiveFlow = useSetAtom(activeSessionFlowAtom);
  const setTabs = useSetAtom(editorTabsAtom);

  /**
   * 防循环：用 "source" 标记当前变更的来源。
   * "hash" = 变更来自 URL，不要再写回 URL
   * "atoms" = 变更来自状态，不要再写回状态
   * null = 无锁
   */
  const sourceRef = useRef<"hash" | "atoms" | null>(null);

  /* atoms → hash：状态变化时更新 URL */
  useEffect(() => {
    if (sourceRef.current === "hash") {
      sourceRef.current = null;
      return;
    }

    const hash = computeHash(activeTab, activePath);
    if (location.hash !== "#" + hash) {
      sourceRef.current = "atoms";
      location.hash = hash;
    }
  }, [activeTab, activeId, activePath]);

  /* hash → atoms：URL 变化时更新状态 */
  useEffect(() => {
    const applyHash = () => {
      if (sourceRef.current === "atoms") {
        sourceRef.current = null;
        return;
      }
      sourceRef.current = "hash";

      const path = parseHash();

      if (!path || path === "/") {
        setActiveTab("flows");
        setActiveId(null);
        setActivePath(null);
        setTabs([]);
        setActiveFlow(null);
        return;
      }

      if (path === "stones") {
        setActiveTab("stones");
        setActiveId(null);
        setActivePath(null);
        setTabs([]);
        return;
      }

      if (path === "world") {
        setActiveTab("world");
        setActiveId(null);
        setActivePath(null);
        setTabs([]);
        return;
      }

      if (path.startsWith("flows/")) {
        setActiveTab("flows");
        const sid = extractSessionId(path);
        if (sid) {
          setActiveId(sid);
          setActivePath(path);
          const resolved = viewRegistry.resolve(path);
          if (resolved) {
            setTabs((prev) => {
              const exists = prev.some(
                (t) => viewRegistry.resolve(t.path)?.tabKey === resolved.tabKey,
              );
              if (exists) {
                return prev.map((t) =>
                  viewRegistry.resolve(t.path)?.tabKey === resolved.tabKey
                    ? { ...t, path }
                    : t,
                );
              }
              return [...prev, { path, label: resolved.tabLabel }];
            });
          }
        }
        return;
      }

      if (path.startsWith("stones/")) {
        setActiveTab("stones");
        setActivePath(path);
        const resolved = viewRegistry.resolve(path);
        if (resolved) {
          setTabs((prev) => {
            const exists = prev.some(
              (t) => viewRegistry.resolve(t.path)?.tabKey === resolved.tabKey,
            );
            if (exists) return prev;
            return [...prev, { path, label: resolved.tabLabel }];
          });
        }
        return;
      }
    };

    window.addEventListener("hashchange", applyHash);

    /* 初始加载：从 URL 恢复状态 */
    if (location.hash && location.hash !== "#/" && location.hash !== "#") {
      applyHash();
    }

    return () => window.removeEventListener("hashchange", applyHash);
  }, []);
}
