/**
 * ThreadsTreeView — 线程树可视化组件（TUI 风格）
 *
 * - 一行一个节点，CSS 连接线
 * - 点击节点查看 thread 详情（actions 列表），左上角返回按钮
 * - 右键添加颜色图钉（10 种可选），支持多图钉
 * - 蓝色图钉自动标记最近查看的 5 个 thread
 * - 图钉持久化到 thread.json
 *
 * @ref docs/superpowers/specs/2026-04-06-thread-tree-architecture-design.md
 */
import { useState, useCallback, useRef, useEffect } from "react";
import { cn } from "../lib/utils";
import { ArrowLeft, Eye, EyeOff } from "lucide-react";
import { TuiAction } from "../components/ui/TuiBlock";
import { MarkdownContent } from "../components/ui/MarkdownContent";
import { updateThreadPins, resumeFlow, fetchFileContent, getContextVisibility } from "../api/client";
import type { Process, ProcessNode, ContextVisibility } from "../api/types";

interface ThreadsTreeViewProps {
  process: Process;
  /** sessionId（用于 pins API） */
  sessionId?: string;
  /** objectName（用于 pins API） */
  objectName?: string;
}

/** 10 种用户可选图钉颜色 */
const PIN_COLORS = [
  { name: "red", color: "#ef4444" },
  { name: "orange", color: "#f97316" },
  { name: "amber", color: "#f59e0b" },
  { name: "green", color: "#22c55e" },
  { name: "teal", color: "#14b8a6" },
  { name: "cyan", color: "#06b6d4" },
  { name: "purple", color: "#a855f7" },
  { name: "pink", color: "#ec4899" },
  { name: "rose", color: "#f43f5e" },
  { name: "indigo", color: "#6366f1" },
] as const;

/** 系统蓝色图钉（最近查看） */
const RECENT_PIN = "recent";
const RECENT_PIN_COLOR = "#3b82f6";
const MAX_RECENT = 5;

/** 状态指示符 */
const STATUS_INDICATOR: Record<string, { color: string; symbol: string }> = {
  running: { color: "text-blue-500", symbol: "●" },
  waiting: { color: "text-amber-500", symbol: "◐" },
  done:    { color: "text-green-600", symbol: "✓" },
  failed:  { color: "text-red-500", symbol: "✗" },
  pending: { color: "text-[var(--muted-foreground)]", symbol: "○" },
  paused:  { color: "text-orange-400", symbol: "⏸" },
};

/** 从 ProcessNode.locals 读取线程元数据 */
function getThreadMeta(node: ProcessNode) {
  const locals = (node.locals ?? {}) as Record<string, unknown>;
  return {
    threadStatus: (locals._threadStatus as string) ?? null,
    creationMode: (locals._creationMode as string) ?? null,
    updatedAt: (locals._updatedAt as number) ?? 0,
    pins: (locals._pins as string[]) ?? [],
    hasPendingOutput: !!locals._hasPendingOutput,
  };
}

/** 格式化时间戳 */
function formatTime(ts: number): string {
  if (!ts) return "";
  const diff = Date.now() - ts;
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  return `${Math.floor(diff / 86_400_000)}d`;
}

/** 获取一句话摘要 */
function getSummary(node: ProcessNode): string {
  if (node.summary) return node.summary.split("\n")[0]!.replace(/^#+\s*/, "");
  if (node.description) return node.description;
  const meaningful = node.actions.filter(
    (a) => a.type === "thinking" || a.type === "text" || a.type === "message_out" || (a.type as string) === "thread_return"
  );
  const last = meaningful[meaningful.length - 1];
  if (last) return last.content.split("\n")[0]!.slice(0, 80);
  return "";
}

/** 递归查找节点 */
function findNode(node: ProcessNode, id: string): ProcessNode | null {
  if (node.id === id) return node;
  for (const child of node.children) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
}

/** 图钉圆点 */
function PinDot({ color }: { color: string }) {
  return (
    <span
      className="inline-block w-2 h-2 rounded-full shrink-0"
      style={{ backgroundColor: color }}
    />
  );
}

/** 获取图钉颜色 */
function getPinColor(pin: string): string {
  if (pin === RECENT_PIN) return RECENT_PIN_COLOR;
  const found = PIN_COLORS.find((p) => p.name === pin);
  return found?.color ?? "#9ca3af";
}

/**
 * Context 可见性视觉配置
 *
 * 为每种可见性分类定义一组 CSS class：
 * - rowClass：整行的背景 / 边框 / 透明度
 * - badge：图例里显示的色块 class
 * - label：图例与 tooltip 里显示的中文名
 *
 * 设计原则：
 * - detailed：最高亮（紫色实心高亮） —— "我自己，完整可见"
 * - summary：中等（蓝色边框） —— "title + summary 出现在 Context"
 * - title_only：低调（灰虚线边框） —— "只有 title，没有 summary"
 * - hidden：弱化（半透明灰阶） —— "完全不在 Context 里"
 * - 不覆盖 status 圆点色，可与 status 独立组合显示
 */
const VIS_STYLE: Record<ContextVisibility, { rowClass: string; badge: string; label: string }> = {
  detailed: {
    rowClass: "bg-purple-100 dark:bg-purple-900/30 border-l-4 border-purple-400",
    badge: "bg-purple-200 border-2 border-purple-400",
    label: "detailed（完整可见）",
  },
  summary: {
    rowClass: "border-l-2 border-blue-400 bg-blue-50/40 dark:bg-blue-900/10",
    badge: "bg-blue-100 border-2 border-blue-400",
    label: "summary（title + 摘要）",
  },
  title_only: {
    rowClass: "border-l border-dashed border-slate-400",
    badge: "border border-dashed border-slate-400",
    label: "title_only（仅 title）",
  },
  hidden: {
    rowClass: "opacity-40",
    badge: "opacity-50 bg-slate-200 border border-slate-300",
    label: "hidden（不可见）",
  },
};

/**
 * 生成 Context 可见性分类的 tooltip 原因描述
 *
 * 规则（对齐 `kernel/src/thread/context-builder.ts`）：
 * - detailed：focus 自身
 * - summary / title_only：祖先、直接子、兄弟
 * - hidden：其他
 */
function buildVisibilityReason(
  nodeId: string,
  focusId: string,
  visibility: ContextVisibility,
  rootNode: ProcessNode,
): string {
  if (nodeId === focusId) return "focus 自身：Context 中以完整 actions 的形式可见";
  if (visibility === "hidden") return "不在 focus 线程的 Context 中（非祖先/直接子/兄弟）";

  /* 判定是祖先 / 子 / 兄弟 */
  const focusNode = findNode(rootNode, focusId);
  if (!focusNode) return VIS_STYLE[visibility].label;
  /* 祖先链 */
  const ancestorIds = new Set<string>();
  (function collectAncestors(n: ProcessNode, target: string): boolean {
    if (n.id === target) return true;
    for (const c of n.children) {
      if (collectAncestors(c, target)) {
        ancestorIds.add(n.id);
        return true;
      }
    }
    return false;
  })(rootNode, focusId);
  if (ancestorIds.has(nodeId)) {
    return `祖先链：${VIS_STYLE[visibility].label}`;
  }
  /* 直接子 */
  if (focusNode.children.some((c) => c.id === nodeId)) {
    return `focus 的直接子：${VIS_STYLE[visibility].label}`;
  }
  /* 兄弟：focus 的父节点的其他子 */
  const parent = findParent(rootNode, focusId);
  if (parent && parent.children.some((c) => c.id === nodeId)) {
    return `同级兄弟：${VIS_STYLE[visibility].label}`;
  }
  return VIS_STYLE[visibility].label;
}

/** 递归查找节点的父节点 */
function findParent(root: ProcessNode, childId: string): ProcessNode | null {
  for (const c of root.children) {
    if (c.id === childId) return root;
    const deeper = findParent(c, childId);
    if (deeper) return deeper;
  }
  return null;
}

export function ThreadsTreeView({ process, sessionId, objectName }: ThreadsTreeViewProps) {
  const [detailNodeId, setDetailNodeId] = useState<string | null>(null);
  const [recentViewed, setRecentViewed] = useState<string[]>([]);
  /* 本地 pins 缓存（覆盖服务端数据，避免刷新延迟） */
  const [localPins, setLocalPins] = useState<Map<string, string[]>>(new Map());
  /* 右键菜单 */
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; nodeId: string } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  /* Ctx View 模式：以某个 focus 线程为观察主体，给每个节点着色可见性 */
  const [ctxViewEnabled, setCtxViewEnabled] = useState(false);
  const [ctxFocusId, setCtxFocusId] = useState<string | null>(null);
  const [ctxVisibility, setCtxVisibility] = useState<Record<string, ContextVisibility>>({});
  const [ctxLoading, setCtxLoading] = useState(false);

  /**
   * 拉取可见性数据
   *
   * ctxViewEnabled 切为 true 或 focus 切换时调用。
   * 失败静默（已有降级显示：无可见性数据时等同普通树视图）。
   */
  const fetchVisibility = useCallback(async (focus?: string) => {
    if (!sessionId || !objectName) return;
    setCtxLoading(true);
    try {
      const result = await getContextVisibility(sessionId, objectName, focus);
      setCtxFocusId(result.focusId);
      setCtxVisibility(result.visibility);
    } catch (e) {
      console.error("[ThreadsTreeView] getContextVisibility failed:", e);
    } finally {
      setCtxLoading(false);
    }
  }, [sessionId, objectName]);

  /* 开启 Ctx View 时首次拉取 */
  useEffect(() => {
    if (ctxViewEnabled && sessionId && objectName) {
      fetchVisibility(ctxFocusId ?? undefined);
    }
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [ctxViewEnabled]);

  /* 点击外部关闭右键菜单 */
  useEffect(() => {
    if (!contextMenu) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [contextMenu]);

  if (!process?.root) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-sm text-[var(--muted-foreground)]">No thread data</p>
      </div>
    );
  }

  /** 获取节点的有效 pins（本地缓存优先） */
  const getNodePins = (node: ProcessNode): string[] => {
    if (localPins.has(node.id)) return localPins.get(node.id)!;
    const meta = getThreadMeta(node);
    return meta.pins;
  };

  /** 合并 recent pins 到节点 pins */
  const getDisplayPins = (node: ProcessNode): string[] => {
    const userPins = getNodePins(node).filter((p) => p !== RECENT_PIN);
    const isRecent = recentViewed.includes(node.id);
    return isRecent ? [RECENT_PIN, ...userPins] : userPins;
  };

  /** 点击节点查看详情 */
  const handleNodeClick = useCallback((nodeId: string) => {
    setDetailNodeId(nodeId);
    setRecentViewed((prev) => {
      const next = [nodeId, ...prev.filter((id) => id !== nodeId)].slice(0, MAX_RECENT);
      return next;
    });
  }, []);

  /** 更新图钉 */
  const handlePinToggle = useCallback((nodeId: string, pinColor: string) => {
    const node = findNode(process.root, nodeId);
    if (!node) return;
    const current = localPins.has(nodeId) ? localPins.get(nodeId)! : getThreadMeta(node).pins;
    const userPins = current.filter((p) => p !== RECENT_PIN);
    const newPins = userPins.includes(pinColor)
      ? userPins.filter((p) => p !== pinColor)
      : [...userPins, pinColor];

    setLocalPins((prev) => new Map(prev).set(nodeId, newPins));
    setContextMenu(null);

    /* 持久化 */
    if (sessionId) {
      updateThreadPins(sessionId, nodeId, newPins, objectName).catch(console.error);
    }
  }, [process.root, localPins, sessionId, objectName]);

  /** 右键菜单 */
  const handleContextMenu = useCallback((e: React.MouseEvent, nodeId: string) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, nodeId });
  }, []);

  /* 详情视图 */
  if (detailNodeId) {
    const node = findNode(process.root, detailNodeId);
    if (!node) {
      setDetailNodeId(null);
      return null;
    }
    return (
      <ThreadDetailView
        node={node}
        onBack={() => setDetailNodeId(null)}
        sessionId={sessionId}
        objectName={objectName}
      />
    );
  }

  /** 切换 Ctx View 模式 */
  const toggleCtxView = () => {
    setCtxViewEnabled((prev) => !prev);
  };

  /** 节点单击：Ctx View 时 = 切换 focus；否则 = 看详情 */
  const handleNodeClickOrFocus = (nodeId: string) => {
    if (ctxViewEnabled) {
      setCtxFocusId(nodeId);
      fetchVisibility(nodeId);
    } else {
      handleNodeClick(nodeId);
    }
  };

  /* 树视图 */
  const focusNode = ctxViewEnabled && ctxFocusId ? findNode(process.root, ctxFocusId) : null;
  return (
    <div className="py-3 font-mono text-[13px] leading-relaxed relative">
      {/* Ctx View 头部（切换按钮 + 图例） */}
      <div className="flex items-center justify-between px-2 pb-2 mb-2 border-b border-[var(--border)]">
        <div className="flex items-center gap-2">
          <button
            onClick={toggleCtxView}
            className={cn(
              "flex items-center gap-1 px-2 py-1 text-xs rounded border transition-colors",
              ctxViewEnabled
                ? "bg-purple-100 dark:bg-purple-900/40 border-purple-400 text-purple-800 dark:text-purple-200"
                : "border-[var(--border)] text-[var(--muted-foreground)] hover:bg-[var(--accent)]",
            )}
            title="切换 Context 可见性视图"
          >
            {ctxViewEnabled ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
            <span>Ctx View</span>
          </button>
          {ctxViewEnabled && focusNode && (
            <span className="text-xs text-[var(--muted-foreground)]">
              focus: <span className="text-[var(--foreground)] font-medium">{focusNode.title}</span>
              {ctxLoading && <span className="ml-2 animate-pulse">加载中…</span>}
            </span>
          )}
        </div>
        {ctxViewEnabled && (
          <div className="flex items-center gap-3 text-[11px]">
            {(["detailed", "summary", "title_only", "hidden"] as ContextVisibility[]).map((v) => (
              <span key={v} className="flex items-center gap-1">
                <span className={cn("inline-block w-3 h-3 rounded-sm", VIS_STYLE[v].badge)} />
                <span className="text-[var(--muted-foreground)]">{VIS_STYLE[v].label}</span>
              </span>
            ))}
          </div>
        )}
      </div>

      <ThreadNode
        node={process.root}
        focusId={process.focusId}
        depth={0}
        onNodeClick={handleNodeClickOrFocus}
        onContextMenu={handleContextMenu}
        getDisplayPins={getDisplayPins}
        ctxViewEnabled={ctxViewEnabled}
        ctxFocusId={ctxFocusId}
        ctxVisibility={ctxVisibility}
        rootNode={process.root}
      />

      {/* 右键图钉菜单 */}
      {contextMenu && (
        <div
          ref={menuRef}
          className="fixed z-50 rounded-lg border border-[var(--border)] bg-[var(--popover)] shadow-lg py-1.5 px-1"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <div className="px-2 py-1 text-[10px] text-[var(--muted-foreground)] uppercase tracking-wide">
            图钉
          </div>
          <div className="grid grid-cols-5 gap-1 px-1.5 py-1">
            {PIN_COLORS.map((pin) => {
              const node = findNode(process.root, contextMenu.nodeId);
              const currentPins = node ? (localPins.has(contextMenu.nodeId) ? localPins.get(contextMenu.nodeId)! : getThreadMeta(node).pins) : [];
              const isActive = currentPins.includes(pin.name);
              return (
                <button
                  key={pin.name}
                  onClick={() => handlePinToggle(contextMenu.nodeId, pin.name)}
                  className={cn(
                    "w-6 h-6 rounded-full flex items-center justify-center transition-all",
                    isActive ? "ring-2 ring-offset-1 ring-[var(--foreground)]/30" : "hover:scale-125",
                  )}
                  style={{ backgroundColor: pin.color }}
                  title={pin.name}
                />
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/** 树节点行 */
function ThreadNode({
  node,
  focusId,
  depth,
  onNodeClick,
  onContextMenu,
  getDisplayPins,
  ctxViewEnabled,
  ctxFocusId,
  ctxVisibility,
  rootNode,
}: {
  node: ProcessNode;
  focusId: string;
  depth: number;
  onNodeClick: (id: string) => void;
  onContextMenu: (e: React.MouseEvent, id: string) => void;
  getDisplayPins: (node: ProcessNode) => string[];
  /** Ctx View 开关状态 —— 开启时用可见性着色 */
  ctxViewEnabled?: boolean;
  /** 当前观察主体线程 ID */
  ctxFocusId?: string | null;
  /** 每节点的可见性分类 map */
  ctxVisibility?: Record<string, ContextVisibility>;
  /** 树根节点（用于计算 tooltip 需要的祖先/兄弟关系） */
  rootNode?: ProcessNode;
}) {
  const meta = getThreadMeta(node);
  const status = meta.hasPendingOutput ? "paused" : (meta.threadStatus ?? (node.status === "doing" ? "running" : node.status === "done" ? "done" : "pending"));
  const indicator = STATUS_INDICATOR[status] ?? STATUS_INDICATOR.pending!;
  const hasChildren = node.children.length > 0;
  const [expanded, setExpanded] = useState(
    status === "running" || status === "waiting" || node.id === focusId || depth < 2
  );
  const summary = getSummary(node);
  const actionCount = node.actions.length;
  const pins = getDisplayPins(node);

  /* Ctx View 着色与 tooltip */
  const visibility = ctxViewEnabled && ctxVisibility ? ctxVisibility[node.id] : undefined;
  const visStyle = visibility ? VIS_STYLE[visibility] : undefined;
  const visTooltip =
    ctxViewEnabled && visibility && ctxFocusId && rootNode
      ? buildVisibilityReason(node.id, ctxFocusId, visibility, rootNode)
      : undefined;

  return (
    <div className="relative">
      {/* 主行 */}
      <div
        className={cn(
          "flex items-baseline gap-0 rounded-sm -mx-1 px-1 group",
          visStyle?.rowClass,
        )}
        onContextMenu={(e) => onContextMenu(e, node.id)}
        title={visTooltip}
      >
        {/* 缩进 */}
        <span className="shrink-0 select-none" style={{ width: depth * 24 }} />

        {/* 展开/折叠 */}
        <span
          className="shrink-0 w-4 text-center select-none text-[var(--muted-foreground)] cursor-pointer"
          onClick={(e) => { e.stopPropagation(); hasChildren && setExpanded(!expanded); }}
        >
          {hasChildren ? (expanded ? "▾" : "▸") : " "}
        </span>

        {/* 状态符号 */}
        <span className={cn("shrink-0 w-4 text-center select-none", indicator.color)}>
          {indicator.symbol}
        </span>

        {/* 图钉 */}
        {pins.length > 0 && (
          <span className="shrink-0 flex items-center gap-0.5 mr-1">
            {pins.map((pin, i) => (
              <PinDot key={`${pin}-${i}`} color={getPinColor(pin)} />
            ))}
          </span>
        )}

        {/* 标题（可点击） */}
        <span
          className={cn(
            "shrink-0 mr-2 cursor-pointer hover:underline",
            status === "done" && "text-[var(--foreground)]/70",
            status === "failed" && "text-red-400",
            status === "running" && "text-[var(--foreground)]",
            status === "waiting" && "text-amber-400",
            status === "pending" && "text-[var(--muted-foreground)]",
          )}
          onClick={() => onNodeClick(node.id)}
        >
          {node.title}
        </span>

        {/* 摘要 */}
        {summary && (
          <span className="truncate text-[var(--muted-foreground)]/50 mr-2">
            {summary}
          </span>
        )}

        {/* 右侧元数据 */}
        <span className="shrink-0 ml-auto flex items-baseline gap-2 text-[11px] text-[var(--muted-foreground)]/50">
          {actionCount > 0 && <span>{actionCount} actions</span>}
          {meta.creationMode && meta.creationMode !== "sub_thread_on_node" && (
            <span>{meta.creationMode}</span>
          )}
          {meta.updatedAt > 0 && <span>{formatTime(meta.updatedAt)}</span>}
        </span>
      </div>

      {/* 子节点 */}
      {expanded && hasChildren && (
        <div className="relative">
          {/* 竖线 */}
          <div
            className="absolute top-0 bottom-3 border-l border-[var(--border)]"
            style={{ left: depth * 24 + 7 }}
          />
          {node.children.map((child) => (
            <div key={child.id} className="relative">
              {/* 拐角连接线 */}
              <div
                className="absolute border-b border-l border-[var(--border)] rounded-bl-[4px]"
                style={{
                  left: depth * 24 + 7,
                  top: 0,
                  width: 13,
                  height: 14,
                }}
              />
              <ThreadNode
                node={child}
                focusId={focusId}
                depth={depth + 1}
                onNodeClick={onNodeClick}
                onContextMenu={onContextMenu}
                getDisplayPins={getDisplayPins}
                ctxViewEnabled={ctxViewEnabled}
                ctxFocusId={ctxFocusId}
                ctxVisibility={ctxVisibility}
                rootNode={rootNode}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Thread 详情视图 */
function ThreadDetailView({
  node,
  onBack,
  sessionId,
  objectName,
}: {
  node: ProcessNode;
  onBack: () => void;
  sessionId?: string;
  objectName?: string;
}) {
  const meta = getThreadMeta(node);
  const status = meta.hasPendingOutput ? "paused" : (meta.threadStatus ?? node.status);
  const [resuming, setResuming] = useState(false);
  const [showContext, setShowContext] = useState(false);
  const [pauseFiles, setPauseFiles] = useState<{ output?: string; input?: string } | null>(null);

  /* 加载暂停文件内容 */
  useEffect(() => {
    if (!meta.hasPendingOutput || !sessionId || !objectName) return;
    const basePath = `flows/${sessionId}/objects/${objectName}/threads/${node.id}`;
    Promise.all([
      fetchFileContent(`${basePath}/llm.output.txt`).catch(() => undefined),
      fetchFileContent(`${basePath}/llm.input.txt`).catch(() => undefined),
    ]).then(([output, input]) => {
      setPauseFiles({ output, input });
    });
  }, [meta.hasPendingOutput, sessionId, objectName, node.id]);

  const handleResume = async () => {
    if (!sessionId || !objectName) return;
    setResuming(true);
    try {
      await resumeFlow(objectName, sessionId);
      onBack();
    } catch (e) {
      console.error(e);
    } finally {
      setResuming(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* 头部 */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--border)] shrink-0">
        <button
          onClick={onBack}
          className="p-1 rounded-md text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)] transition-colors"
          title="返回线程树"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-medium truncate">{node.title}</h3>
            <span className={cn(
              "text-[10px] font-mono",
              status === "paused" ? "text-orange-400" : "text-[var(--muted-foreground)]",
            )}>{status}</span>
          </div>
          <span className="text-[10px] text-[var(--muted-foreground)] font-mono">{node.id}</span>
        </div>
        {meta.hasPendingOutput && sessionId && objectName && (
          <button
            onClick={handleResume}
            disabled={resuming}
            className="px-3 py-1 text-xs rounded bg-[var(--primary)] text-[var(--primary-foreground)] hover:opacity-90 disabled:opacity-50 transition-opacity shrink-0"
          >
            {resuming ? "恢复中..." : "恢复执行"}
          </button>
        )}
      </div>

      {/* 摘要 + 暂停面板 + Actions 合并滚动 */}
      <div className="flex-1 overflow-auto px-4 py-3 space-y-1.5">
        {/* 暂停面板 */}
        {meta.hasPendingOutput && pauseFiles && (
          <div className="rounded bg-[var(--warm-muted)] p-3 mb-3">
            <p className="text-xs font-medium mb-2">Thread 已暂停 — 待执行的 LLM Output:</p>
            {pauseFiles.output ? (
              <pre className="text-xs font-mono bg-[var(--card)] rounded p-2 overflow-auto max-h-60 whitespace-pre-wrap">{pauseFiles.output}</pre>
            ) : (
              <p className="text-xs text-[var(--muted-foreground)]">(无法读取 llm.output.txt)</p>
            )}
            {pauseFiles.input && (
              <div className="mt-2">
                <button
                  onClick={() => setShowContext(!showContext)}
                  className="text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
                >
                  {showContext ? "▾ 收起 Context" : "▸ 查看 Context"}
                </button>
                {showContext && (
                  <pre className="mt-1 text-xs font-mono bg-[var(--card)] rounded p-2 overflow-auto max-h-60 whitespace-pre-wrap">{pauseFiles.input}</pre>
                )}
              </div>
            )}
          </div>
        )}

        {node.summary && (
          <div className="text-sm pb-3 mb-2 border-b border-[var(--border)]">
            <MarkdownContent content={node.summary} />
          </div>
        )}
        {node.actions.length === 0 ? (
          <p className="text-sm text-[var(--muted-foreground)]">暂无 actions</p>
        ) : (
          node.actions.map((action, i) => (
            <TuiAction
              key={`${action.type}-${i}`}
              action={action}
              objectName={node.title}
            />
          ))
        )}
      </div>
    </div>
  );
}
