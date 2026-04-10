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

export function useHashRouter() {
  const [activeTab, setActiveTab] = useAtom(activeTabAtom);
  const [activeId, setActiveId] = useAtom(activeSessionIdAtom);
  const [activePath, setActivePath] = useAtom(activeFilePathAtom);
  const setActiveFlow = useSetAtom(activeSessionFlowAtom);
  const setTabs = useSetAtom(editorTabsAtom);

  /* 防止循环更新 */
  const suppressHashUpdate = useRef(false);
  const suppressAtomUpdate = useRef(false);

  /* atoms → hash：状态变化时更新 URL */
  useEffect(() => {
    if (suppressAtomUpdate.current) {
      suppressAtomUpdate.current = false;
      return;
    }
    suppressHashUpdate.current = true;

    let hash = "/";
    if (activePath) {
      hash = "/" + activePath;
    } else if (activeTab === "stones") {
      hash = "/stones";
    } else if (activeTab === "world") {
      hash = "/world";
    }

    if (location.hash !== "#" + hash) {
      location.hash = hash;
    }

    requestAnimationFrame(() => {
      suppressHashUpdate.current = false;
    });
  }, [activeTab, activeId, activePath]);

  /* hash → atoms：URL 变化时更新状态 */
  useEffect(() => {
    const applyHash = () => {
      if (suppressHashUpdate.current) return;
      suppressAtomUpdate.current = true;

      const path = parseHash();

      if (!path || path === "/") {
        /* Welcome 页面 */
        setActiveTab("flows");
        setActiveId(null);
        setActivePath(null);
        setTabs([]);
        setActiveFlow(null);
        return;
      }

      if (path === "stones") {
        setActiveTab("stones");
        setActivePath(null);
        setTabs([]);
        return;
      }

      if (path === "world") {
        setActiveTab("world");
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
          /* 自动创建 tab */
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
