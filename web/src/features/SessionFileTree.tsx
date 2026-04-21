/**
 * SessionFileTree — 当前 session 的文件目录树（侧边栏）
 *
 * 在 flows tab 中，当有活跃 session 时展示该 session 的文件结构。
 * 注入虚拟节点：
 * - index（session 根级）→ 打开 Chat "all" 视图
 * - .stone（每个 flow 对象目录下）→ 展示对应 stones/{objectId}/ 的文件树
 */
import { useState, useEffect } from "react";
import { useAtomValue } from "jotai";
import { lastFlowEventAtom } from "../store/session";
import { fetchSessionTree, fetchStoneTree } from "../api/client";
import { FileTree } from "../components/ui/FileTree";
import type { FileTreeNode } from "../api/types";

interface SessionFileTreeProps {
  sessionId: string;
  onSelect?: (path: string, node: FileTreeNode) => void;
  selectedPath?: string;
}

/**
 * 增强文件树：注入 index 虚拟节点 + .stone 虚拟目录 + 过滤冗余文件
 */
async function enhanceTree(tree: FileTreeNode, sessionId: string): Promise<FileTreeNode> {
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
  const objectsDir = enhanced.children.find(
    (c) => c.type === "directory" && c.name === "objects"
  );

  /* Stone 目录下隐藏的文件 */
  const STONE_HIDDEN = new Set(["readme.md", "memory.md", "data.json"]);
  /* Stone 目录下隐藏的子目录 */
  const STONE_HIDDEN_DIRS = new Set(["traits"]);
  /* Flow 目录下隐藏的文件 */
  const FLOW_HIDDEN = new Set(["data.json", "process.json"]);

  const filterChildren = (children: FileTreeNode[] | undefined, hiddenFiles: Set<string>, hiddenDirs?: Set<string>): FileTreeNode[] => {
    if (!children) return [];
    return children.filter((c) => {
      if (c.type === "file" && hiddenFiles.has(c.name)) return false;
      if (c.type === "directory" && hiddenDirs?.has(c.name)) return false;
      return true;
    });
  };

  if (objectsDir?.children) {
    const newFlowChildren: FileTreeNode[] = [];
    for (const child of objectsDir.children) {
      if (child.type === "directory" && child.marker === "flow") {
        const objectName = child.name;

        /* 过滤 flow 目录下的冗余文件 */
        const filteredFlowChildren = filterChildren(child.children, FLOW_HIDDEN);

        /* 注入 .stone 虚拟目录（过滤 stone 冗余文件 + super 目录冗余文件） */
        try {
          const stoneTree = await fetchStoneTree(objectName);
          const stoneChildren = filterChildren(stoneTree.children, STONE_HIDDEN, STONE_HIDDEN_DIRS).map((c) => {
            /* super 目录当作 flow 目录处理：隐藏 data.json/process.json */
            if (c.type === "directory" && c.name === "super") {
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
    objectsDir.children = newFlowChildren;
  }

  return enhanced;
}

export function SessionFileTree({ sessionId, onSelect, selectedPath }: SessionFileTreeProps) {
  const [tree, setTree] = useState<FileTreeNode | null>(null);
  const [loading, setLoading] = useState(true);
  const lastEvent = useAtomValue(lastFlowEventAtom);

  /* 加载 session 文件树 + 增强 */
  useEffect(() => {
    setLoading(true);
    fetchSessionTree(sessionId)
      .then((raw) => enhanceTree(raw, sessionId))
      .then(setTree)
      .catch(() => setTree(null))
      .finally(() => setLoading(false));
  }, [sessionId]);

  /* SSE 事件触发刷新 */
  useEffect(() => {
    if (!lastEvent || !("sessionId" in lastEvent)) return;
    if (lastEvent.sessionId === sessionId) {
      fetchSessionTree(sessionId)
        .then((raw) => enhanceTree(raw, sessionId))
        .then(setTree)
        .catch(() => {});
    }
  }, [lastEvent, sessionId]);

  if (loading) {
    return <p className="px-3 py-4 text-xs text-[var(--muted-foreground)] text-center">加载中...</p>;
  }

  if (!tree) {
    return <p className="px-3 py-4 text-xs text-[var(--muted-foreground)] text-center">无文件</p>;
  }

  return (
    <div className="overflow-auto px-1">
      <FileTree root={tree} onSelect={onSelect} selectedPath={selectedPath} />
    </div>
  );
}
