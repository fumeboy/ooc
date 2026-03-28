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
 * 增强文件树：注入 index 虚拟节点 + .stone 虚拟目录
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

  /* 2. 查找 flows/ 目录 + 为有 files/ui/ 的 flow 对象注入 ui 虚拟节点 */
  const flowsDir = enhanced.children.find(
    (c) => c.type === "directory" && c.name === "flows"
  );
  if (flowsDir?.children) {
    for (const child of flowsDir.children) {
      if (child.type === "directory" && child.marker === "flow") {
        const hasUI = child.children?.some(
          (c) => c.type === "directory" && c.name === "files" &&
            c.children?.some((sc) => sc.type === "directory" && sc.name === "ui")
        );
        if (hasUI) {
          const uiNode: FileTreeNode = {
            name: "ui",
            type: "file",
            path: `flows/${sessionId}/flows/${child.name}/files/ui`,
            size: 0,
          };
          child.children = [uiNode, ...(child.children ?? [])];
        }
      }
    }
  }

  /* 3. 为每个 flow 对象注入 .stone 虚拟目录 */
  if (flowsDir?.children) {
    const newFlowChildren: FileTreeNode[] = [];
    for (const child of flowsDir.children) {
      if (child.type === "directory" && child.marker === "flow") {
        const objectName = child.name;
        /* 尝试获取对应 stone 的文件树 */
        try {
          const stoneTree = await fetchStoneTree(objectName);
          const stoneVirtual: FileTreeNode = {
            name: ".stone",
            type: "directory",
            path: `stones/${objectName}`,
            marker: "stone",
            children: stoneTree.children ?? [],
          };
          /* 注入 .stone 到 flow 目录的 children 最前面 */
          const enhancedChild: FileTreeNode = {
            ...child,
            children: [stoneVirtual, ...(child.children ?? [])],
          };
          newFlowChildren.push(enhancedChild);
        } catch {
          /* stone 不存在，保持原样 */
          newFlowChildren.push(child);
        }
      } else {
        newFlowChildren.push(child);
      }
    }
    flowsDir.children = newFlowChildren;
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
    if (!lastEvent || !("taskId" in lastEvent)) return;
    if (lastEvent.taskId === sessionId) {
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
      <FileTree root={tree} onSelect={onSelect} selectedPath={selectedPath} defaultExpanded />
    </div>
  );
}
