/**
 * SessionFileTree — 所有 sessions 的文件目录树（侧边栏）
 *
 * 在 flows tab 中展示 flows/ 下所有 session 的文件结构。
 * 每个 session 显示为一个目录节点，名称为 session title。
 * 注入虚拟节点：
 * - index（session 根级）→ 打开 Chat "all" 视图
 * - .stone（每个 flow 对象目录下）→ 展示对应 stones/{objectId}/ 的文件树
 * - ui（有 files/ui/ 的 flow 对象下）→ 打开自渲染 UI
 */
import { useState, useEffect } from "react";
import { useAtomValue } from "jotai";
import { lastFlowEventAtom } from "../store/session";
import { fetchSessions, fetchSessionTree, fetchStoneTree } from "../api/client";
import { FileTree } from "../components/ui/FileTree";
import type { FileTreeNode } from "../api/types";
import type { FlowSummary } from "../api/types";

interface SessionFileTreeProps {
  onSelect?: (path: string, node: FileTreeNode) => void;
  selectedPath?: string;
}

/**
 * 增强单个 session 的文件树：注入 index + .stone + ui 虚拟节点
 */
async function enhanceSessionTree(tree: FileTreeNode, sessionId: string): Promise<FileTreeNode> {
  const enhanced = { ...tree, children: [...(tree.children ?? [])] };

  /* 1. 在根级插入 index 虚拟节点 */
  const indexNode: FileTreeNode = {
    name: "index",
    type: "file",
    path: `flows/${sessionId}`,
    size: 0,
  };
  enhanced.children.unshift(indexNode);

  /* 2. 过滤文件 + 注入 .stone 虚拟目录 */
  const flowsDir = enhanced.children.find(
    (c) => c.type === "directory" && c.name === "flows"
  );

  /* Stone 目录下隐藏的文件 */
  const STONE_HIDDEN = new Set(["readme.md", "memory.md", "data.json"]);
  /* Flow 目录下隐藏的文件 */
  const FLOW_HIDDEN = new Set(["data.json", "process.json"]);

  const filterChildren = (children: FileTreeNode[] | undefined, hidden: Set<string>): FileTreeNode[] => {
    if (!children) return [];
    return children.filter((c) => !(c.type === "file" && hidden.has(c.name)));
  };

  if (flowsDir?.children) {
    const newFlowChildren: FileTreeNode[] = [];
    for (const child of flowsDir.children) {
      if (child.type === "directory" && child.marker === "flow") {
        const objectName = child.name;

        /* 过滤 flow 目录下的冗余文件 */
        const filteredFlowChildren = filterChildren(child.children, FLOW_HIDDEN);

        /* 注入 .stone 虚拟目录（过滤 stone 冗余文件 + reflect 目录冗余文件） */
        try {
          const stoneTree = await fetchStoneTree(objectName);
          const stoneChildren = filterChildren(stoneTree.children, STONE_HIDDEN).map((c) => {
            /* reflect 目录当作 flow 目录处理：隐藏 data.json/process.json */
            if (c.type === "directory" && c.name === "reflect") {
              return { ...c, children: filterChildren(c.children, FLOW_HIDDEN) };
            }
            return c;
          });
          const stoneVirtual: FileTreeNode = {
            name: ".stone",
            type: "directory",
            path: `stones/${objectName}`,
            marker: "stone",
            children: stoneChildren,
          };
          newFlowChildren.push({
            ...child,
            children: [stoneVirtual, ...filteredFlowChildren],
          });
        } catch {
          newFlowChildren.push({ ...child, children: filteredFlowChildren });
        }
      } else {
        newFlowChildren.push(child);
      }
    }
    flowsDir.children = newFlowChildren;
  }

  return enhanced;
}

export function SessionFileTree({ onSelect, selectedPath }: SessionFileTreeProps) {
  const [tree, setTree] = useState<FileTreeNode | null>(null);
  const [loading, setLoading] = useState(true);
  const lastEvent = useAtomValue(lastFlowEventAtom);

  /* 构建所有 sessions 的文件树 */
  const buildTree = async () => {
    const sessions = await fetchSessions();
    /* 按更新时间倒序（API 已排序） */
    const sessionNodes: FileTreeNode[] = [];

    for (const session of sessions) {
      const title = session.title
        || session.firstMessage?.slice(0, 40)
        || session.taskId.slice(0, 16);

      const sessionNode: FileTreeNode = {
        name: title,
        type: "directory",
        path: `flows/${session.taskId}`,
        marker: "flow",
        children: [],
      };

      /* 尝试加载并增强 session 内部文件树 */
      try {
        const rawTree = await fetchSessionTree(session.taskId);
        const enhanced = await enhanceSessionTree(rawTree, session.taskId);
        sessionNode.children = enhanced.children;
      } catch {
        /* 加载失败，保留空目录 */
      }

      sessionNodes.push(sessionNode);
    }

    const root: FileTreeNode = {
      name: "flows",
      type: "directory",
      path: "flows",
      children: sessionNodes,
    };

    return root;
  };

  /* 初始加载 */
  useEffect(() => {
    setLoading(true);
    buildTree()
      .then(setTree)
      .catch(() => setTree(null))
      .finally(() => setLoading(false));
  }, []);

  /* SSE 事件触发刷新 */
  useEffect(() => {
    if (!lastEvent) return;
    buildTree().then(setTree).catch(() => {});
  }, [lastEvent]);

  if (loading) {
    return <p className="px-3 py-4 text-xs text-[var(--muted-foreground)] text-center">加载中...</p>;
  }

  if (!tree) {
    return <p className="px-3 py-4 text-xs text-[var(--muted-foreground)] text-center">无会话</p>;
  }

  return (
    <div className="overflow-auto px-1">
      <FileTree root={tree} onSelect={onSelect} selectedPath={selectedPath} />
    </div>
  );
}
