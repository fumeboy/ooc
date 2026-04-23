/**
 * TUI 风格消息组件
 *
 * 模仿 Claude Code TUI 的设计语言：
 * - 无卡片边框，内容直接流式展示
 * - 行前缀标记区分类型（❯ ◆ ▸ ✓ ✗ 等）
 * - 等宽字体为主，正文可用比例字体
 * - 颜色极简：绿=成功、红=错误、灰=次要、蓝=链接、琥珀=思考
 * - 支持折叠/展开长内容
 * - 支持 SSE 流式追加（loading 状态）
 */
import { useState, useMemo, useEffect, useCallback } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cn } from "../../lib/utils";
import { MarkdownContent } from "./MarkdownContent";
import { Copy, Check, ChevronRight, ChevronDown, Loader2, Maximize2, X } from "lucide-react";
import type { Action, FlowMessage } from "../../api/types";
import { EditDiffCard, detectEditDiffEntries } from "../EditDiffCard";
import { EditPlanView, type EditPlanViewModel } from "../../features/EditPlanView";
import {
  getEditPlan,
  applyEditPlan as apiApplyEditPlan,
  cancelEditPlan as apiCancelEditPlan,
} from "../../api/client";

/** program/action 内容截断阈值 */
const TRUNCATE_MAX_LINES = 8;
const TRUNCATE_MAX_CHARS = 300;

/* ── 复制按钮 ── */
function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="opacity-0 group-hover:opacity-100 ml-1 inline-flex items-center justify-center w-5 h-5 rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-all"
      title={copied ? "已复制" : "复制"}
    >
      {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
    </button>
  );
}

/* ── 类型前缀配置 ── */
const TYPE_CONFIG: Record<string, { prefix: string; color: string; label: string }> = {
  thinking:       { prefix: "◆", color: "text-amber-500",  label: "thinking" },
  text:           { prefix: "◇", color: "text-slate-400",  label: "text" },
  tool_use:       { prefix: "⚙", color: "text-blue-400",   label: "tool" },
  program:        { prefix: "▸", color: "text-blue-400",   label: "program" },
  inject:         { prefix: "›", color: "text-orange-400", label: "inject" },
  message_in:     { prefix: "←", color: "text-green-400",  label: "in" },
  message_out:    { prefix: "→", color: "text-teal-400",   label: "out" },
  set_plan:       { prefix: "◇", color: "text-violet-400", label: "plan" },
  mark_inbox:     { prefix: "✓", color: "text-emerald-400", label: "mark" },
  create_thread:  { prefix: "⑂", color: "text-blue-400", label: "fork" },
  thread_return:  { prefix: "⏎", color: "text-green-400", label: "return" },
};
const DEFAULT_CONFIG = { prefix: "·", color: "text-gray-400", label: "unknown" };

/* ── tool_use 四原语角标配置：open/submit/close/wait ──
 * 之前 tool_use 一律显示 "tool" + 蓝色齿轮，无区分度。根据实际工具名（action.name）
 * 使用不同图标 + 颜色：
 *   open   — ⬒（frame） violet，表示"打开上下文/申请指令"
 *   submit — ▶（前进）   sky，表示"提交执行"
 *   close  — ⊘（禁止圈） slate，表示"关闭/取消"
 *   wait   — ⏸（暂停）   amber，表示"等待外部响应"
 * 其他 tool 名保持 fallback（⚙ tool 蓝色）。 */
const TOOL_CONFIG: Record<string, { prefix: string; color: string; label: string }> = {
  open:   { prefix: "⬒", color: "text-violet-400", label: "open" },
  submit: { prefix: "▶", color: "text-sky-400",    label: "submit" },
  close:  { prefix: "⊘", color: "text-slate-400",  label: "close" },
  wait:   { prefix: "⏸", color: "text-amber-400",  label: "wait" },
};

/* ── 时间格式化 ── */
function formatTs(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/* ── 文本截断工具（行数 + 字符数双重限制） ── */
function truncateText(text: string): { truncated: string; isTruncated: boolean } {
  const lines = text.split("\n");
  if (lines.length <= TRUNCATE_MAX_LINES && text.length <= TRUNCATE_MAX_CHARS) {
    return { truncated: text, isTruncated: false };
  }
  /* 先按行截断 */
  let result = lines.length > TRUNCATE_MAX_LINES
    ? lines.slice(0, TRUNCATE_MAX_LINES).join("\n")
    : text;
  /* 再按字符截断 */
  if (result.length > TRUNCATE_MAX_CHARS) {
    result = result.slice(0, TRUNCATE_MAX_CHARS);
  }
  return { truncated: result + " …", isTruncated: true };
}

/* ── 全文模态窗 ── */
function FullTextModal({ open, onClose, title, content, result }: {
  open: boolean;
  onClose: () => void;
  title: string;
  content: string;
  result?: string;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed z-50 inset-4 md:inset-[10%] flex flex-col bg-[var(--card)] rounded-xl shadow-2xl overflow-hidden data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
        >
          <DialogPrimitive.Title className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)] shrink-0">
            <span className="font-mono text-sm font-semibold">{title}</span>
            <DialogPrimitive.Close className="p-1 rounded hover:bg-[var(--accent)] transition-colors">
              <X className="w-4 h-4" />
            </DialogPrimitive.Close>
          </DialogPrimitive.Title>
          <div className="flex-1 overflow-auto p-4 font-mono text-[12px]">
            <pre className="whitespace-pre-wrap break-all text-[var(--foreground)]">{content}</pre>
            {result && (
              <div className="mt-3 border-t border-[var(--border)] pt-3">
                <span className="text-[10px] text-[var(--muted-foreground)] font-semibold uppercase tracking-wider">output</span>
                <pre className="mt-1 whitespace-pre-wrap break-all text-[var(--foreground)] opacity-70">{result}</pre>
              </div>
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/**
 * 从 submit args 的旁枝字段推断 command（历史落盘 + 运行时 open/submit 时 command 字段
 * 可能未落在 action.args 里，这里做兜底，使前端可以识别 think/talk 渲染）
 */
function inferCommandFromArgs(args: Record<string, unknown>): string | undefined {
  if ("context" in args && ("msg" in args || "threadId" in args) && "target" in args) return "talk";
  if ("context" in args && ("msg" in args || "threadId" in args)) return "think";
  return undefined;
}

/* ── inject 内容解析 ── */
function parseInjectTitle(content: string): { title: string; body: string } {
  const m = content.match(/^>>>\s*\[系统提示 — ([^\|\]]+)(?:\s*\|\s*([^\]]+))?\]\s*(\n|$)/);
  if (m) {
    const title = m[2]?.trim() || m[1]?.trim() || "系统提示";
    return { title, body: content.slice(m[0].length) };
  }
  const firstLine = content.split("\n")[0] || "";
  return { title: firstLine.slice(0, 60), body: content };
}

/**
 * 从 inject / program action 中抽取 file_ops.plan_edits 的 planId
 *
 * 检测 pattern（与 `detectEditDiffEntries` 同风格）：
 *   - inject.content: `>>> file_ops.plan_edits 结果:\n<JSON>`
 *   - program.result: `>>> output:\n<JSON>`（JSON 里含 planId 字段时也捕获）
 *   - 若 tool_use submit(command=plan_edits) 的 result 里能解出 planId，也算命中
 *
 * 返回 null 表示此 action 不是 plan_edits 结果。
 */
function detectPlanEditsRef(action: {
  type: string;
  content?: string;
  result?: string;
  name?: string;
  args?: Record<string, unknown>;
}): { planId: string } | null {
  /* 统一的 JSON 抽取：找到 { ... } 首个平衡块 */
  const tryExtractJson = (text: string): unknown => {
    try {
      return JSON.parse(text);
    } catch {
      /* 容错：从文本里找第一个合法 {…} */
      const idx = text.indexOf("{");
      if (idx < 0) return null;
      for (let end = text.length; end > idx; end--) {
        try {
          return JSON.parse(text.slice(idx, end));
        } catch {
          /* try next */
        }
      }
      return null;
    }
  };

  /* 读 tool-result 包装 { ok, data } 里的 planId */
  const pickPlanId = (parsed: unknown): string | null => {
    if (parsed === null || typeof parsed !== "object") return null;
    const obj = parsed as Record<string, unknown>;
    const data = obj.ok === true && typeof obj.data === "object" && obj.data !== null
      ? (obj.data as Record<string, unknown>)
      : obj;
    if (typeof data.planId === "string" && data.planId.length > 0) return data.planId;
    return null;
  };

  if (action.type === "inject" && typeof action.content === "string") {
    const m = action.content.match(/^>>>\s*([^\s]+?)\s*结果:\n([\s\S]+)$/);
    if (m && m[1]?.includes("plan_edits")) {
      const planId = pickPlanId(tryExtractJson(m[2] ?? ""));
      if (planId) return { planId };
    }
    return null;
  }

  if (action.type === "program" && typeof action.result === "string") {
    const text = action.result;
    if (!text.includes("planId")) return null;
    const stripped = text.replace(/^>>>\s*output:\s*/i, "");
    const planId = pickPlanId(tryExtractJson(stripped));
    if (planId) return { planId };
    return null;
  }

  /* tool_use 兜底：submit(command=plan_edits) 的 result 字段可能是 JSON */
  if (action.type === "tool_use" && action.name === "submit") {
    const cmd = action.args?.command;
    if (cmd === "plan_edits" && typeof action.result === "string") {
      const planId = pickPlanId(tryExtractJson(action.result));
      if (planId) return { planId };
    }
  }

  return null;
}

/* ================================================================
 *  EditPlanCard — 根据 planId 懒加载 plan 详情并嵌入 EditPlanView
 * ================================================================ */

interface EditPlanCardProps {
  planId: string;
  sessionId: string;
  /** apply 时作为 feedback bucket 的线程 id（一般是当前 action 所在线程） */
  threadId?: string;
}

/**
 * EditPlanCard — 前端编辑事务闭环入口
 *
 * 渲染策略：
 *  1. mount 时 GET plan + preview
 *  2. 失败 → 显示错误文案（不影响父 action 其他部分）
 *  3. 成功 → 渲染 EditPlanView，钩住 onApply / onCancel 发 HTTP
 *  4. 按钮点完后本地更新 plan.status（无需等后端事件）
 */
function EditPlanCard({ planId, sessionId, threadId }: EditPlanCardProps) {
  const [plan, setPlan] = useState<EditPlanViewModel | null>(null);
  const [preview, setPreview] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getEditPlan(sessionId, planId)
      .then((res) => {
        if (cancelled) return;
        /* 后端 plan.changes 是 readonly 数组，组件模型要求可读数组即可 */
        setPlan({
          planId: res.plan.planId,
          status: res.plan.status,
          createdAt: res.plan.createdAt,
          changes: [...res.plan.changes],
        });
        setPreview(res.preview);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, planId]);

  const onApply = useCallback(async (id: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await apiApplyEditPlan(sessionId, id, threadId);
      setPlan((prev) => (prev ? { ...prev, status: res.plan.status } : prev));
      if (!res.result.ok) setError(res.result.error ?? "应用失败");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [sessionId, threadId, busy]);

  const onCancel = useCallback(async (id: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await apiCancelEditPlan(sessionId, id);
      setPlan((prev) => (prev ? { ...prev, status: res.plan.status } : prev));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [sessionId, busy]);

  if (loading) {
    return (
      <div className="mt-1.5 text-[11px] text-[var(--muted-foreground)] italic flex items-center gap-1">
        <Loader2 className="w-3 h-3 animate-spin" />
        加载 plan {planId}…
      </div>
    );
  }
  if (error && !plan) {
    return (
      <div className="mt-1.5 text-[11px] text-rose-500">
        plan {planId} 加载失败: {error}
      </div>
    );
  }
  if (!plan) return null;

  return (
    <div className="mt-1.5">
      <EditPlanView plan={plan} preview={preview} onApply={onApply} onCancel={onCancel} />
      {error && (
        <div className="mt-1 text-[11px] text-rose-500">{error}</div>
      )}
      {busy && (
        <div className="mt-1 text-[11px] text-[var(--muted-foreground)] italic flex items-center gap-1">
          <Loader2 className="w-3 h-3 animate-spin" /> 处理中…
        </div>
      )}
    </div>
  );
}

/* ================================================================
 *  TuiAction — 替代 ActionCard
 * ================================================================ */

interface TuiActionProps {
  action: Action;
  objectName?: string;
  loading?: boolean;
  /** 内容区域最大高度（超出时可滚动，默认不限制） */
  maxHeight?: number | string;
  /** 用于 plan_edits 闭环：发起 apply/cancel HTTP 时需要 sessionId */
  sessionId?: string;
  /** 用于 plan_edits.apply 的 feedback 隔离：当前 action 所在线程 id */
  threadId?: string;
}

export function TuiAction({ action, objectName, loading, maxHeight, sessionId, threadId }: TuiActionProps) {
  const isInject = action.type === "inject";
  const isThinking = action.type === "thinking";
  const isProgram = action.type === "program";
  const isToolUse = action.type === "tool_use";
  /* tool_use 时按工具名（open/submit/close/wait）选角标；非 tool_use 或其他工具名回退到 TYPE_CONFIG.tool_use */
  const baseCfg = TYPE_CONFIG[action.type] ?? DEFAULT_CONFIG;
  const toolCfg = isToolUse && action.name ? TOOL_CONFIG[action.name] : undefined;
  const cfg = toolCfg ?? baseCfg;
  const [expanded, setExpanded] = useState(!isInject);
  const [modalOpen, setModalOpen] = useState(false);

  /* think/talk 的 context/threadId 徽章（submit 时 args 中含有） */
  const args = (action.args ?? {}) as Record<string, unknown>;
  const submitCommand = isToolUse && action.name === "submit"
    ? (args["command"] as string | undefined) ?? inferCommandFromArgs(args)
    : undefined;
  const isThinkOrTalk = submitCommand === "think" || submitCommand === "talk" || submitCommand === "talk_sync";
  const ctx = args["context"] as ("fork" | "continue" | undefined);
  const threadIdArg = args["threadId"] as (string | undefined);

  /* tool_use: 显示工具名+参数摘要 */
  const toolLabel = isToolUse && action.name
    ? `${action.name}(${Object.keys(action.args ?? {}).slice(0, 3).join(", ")}${Object.keys(action.args ?? {}).length > 3 ? "..." : ""})`
    : null;

  const injectParsed = isInject ? parseInjectTitle(action.content) : null;
  const displayContent = isInject ? (injectParsed?.body ?? action.content) : action.content;

  /* program / tool_use 的内容都是代码/JSON 文本——统一 truncate 且用 pre 展示 */
  const isCodeLike = isProgram || isToolUse;
  const contentTrunc = isCodeLike ? truncateText(action.content) : null;
  const resultTrunc = isProgram && action.result ? truncateText(action.result) : null;
  const needsModal = contentTrunc?.isTruncated || resultTrunc?.isTruncated;

  /* tool_use 的自叙标题 title 作为主文案显示，优先级高于 toolLabel */
  const hasTitle = isToolUse && typeof action.title === "string" && action.title.trim().length > 0;

  /**
   * 文件编辑 diff entries（file_ops.editFile/writeFile/applyEdits 的 before/after）
   *
   * 命中时：
   *  - inject 类型：用 EditDiffCard[] 替换原文本渲染（更直观）
   *  - program 类型：在 result 下方追加 EditDiffCard[]（不替换 result，保留 program 输出）
   *  - 旧 action（result/content 不含 before/after）：detectEditDiffEntries 返回 []
   *    自动 fallback 到原渲染——向后兼容
   */
  const diffEntries = useMemo(() => detectEditDiffEntries(action), [action]);
  const hasDiff = diffEntries.length > 0;

  /**
   * plan_edits 结果检测：若 action 是 file_ops.plan_edits 返回（inject/program），
   * 额外渲染 EditPlanCard（查看 diff / 应用 / 取消）。不替换原 action 主体渲染——
   * plan 卡片挂在下方作为交互入口。仅在有 sessionId 时渲染，避免无法发 HTTP 时的空壳按钮。
   */
  const planRef = useMemo(() => detectPlanEditsRef(action), [action]);
  const hasPlan = planRef !== null && !!sessionId;

  return (
    <div className="group font-mono text-[12px] leading-relaxed">
      {/* 头部行 */}
      <div
        className={cn(
          "flex items-baseline gap-1.5",
          isInject && "cursor-pointer",
        )}
        onClick={isInject ? () => setExpanded(!expanded) : undefined}
      >
        <span className={cn("shrink-0 select-none", cfg.color)}>{cfg.prefix}</span>
        <span className={cn("shrink-0 font-semibold", cfg.color)}>{cfg.label}</span>
        {/* think/talk 徽章：显示 command + fork|continue + threadId 摘要 */}
        {isThinkOrTalk && (
          <span
            className={cn(
              "shrink-0 px-1 py-px rounded text-[10px] font-mono",
              ctx === "continue" ? "bg-teal-500/20 text-teal-400" : "bg-blue-500/20 text-blue-400",
            )}
          >
            {submitCommand}
            {ctx ? `·${ctx}` : ""}
            {threadIdArg ? `·${threadIdArg.slice(0, 12)}` : ""}
          </span>
        )}
        {/* hasTitle 时：header 只显示类型 + 徽章 + title；toolLabel 抬到第二行 */}
        {hasTitle ? (
          <span className="text-[var(--foreground)] font-medium truncate flex-1 min-w-0">{action.title}</span>
        ) : (
          toolLabel && (
            <span className="text-[var(--foreground)] opacity-80 truncate">{toolLabel}</span>
          )
        )}
        {objectName && (
          <span className="text-[var(--muted-foreground)] opacity-60 shrink-0">{objectName}</span>
        )}
        {isProgram && action.success !== undefined && (
          <span className={action.success === false ? "text-red-400 font-semibold" : "text-green-400 font-semibold"}>
            {action.success === false ? "✗" : "✓"}
          </span>
        )}
        {loading && <Loader2 className="w-3 h-3 animate-spin text-[var(--muted-foreground)]" />}
        {isInject && (
          <>
            <span className="text-[var(--muted-foreground)] truncate flex-1">{injectParsed?.title}</span>
            <span className="text-[var(--muted-foreground)] shrink-0">
              {expanded ? <ChevronDown className="w-3 h-3 inline" /> : <ChevronRight className="w-3 h-3 inline" />}
            </span>
          </>
        )}
        <span className="text-[var(--muted-foreground)] opacity-40 shrink-0 ml-auto">{formatTs(action.timestamp)}</span>
        <CopyBtn text={action.content} />
      </div>

      {/* hasTitle 时，第二行：toolLabel（原 toolName(args) 摘要）作为次级信息 */}
      {hasTitle && toolLabel && (
        <div className="pl-5 text-[var(--muted-foreground)] text-[10px] opacity-70 truncate leading-tight">
          {toolLabel}
        </div>
      )}

      {/* 内容区 */}
      {expanded && (
        <div
          className="pl-5 mt-0.5"
          style={maxHeight != null
            ? { maxHeight: typeof maxHeight === "number" ? `${maxHeight}px` : maxHeight, overflow: "auto" }
            : undefined}
        >
          {isCodeLike ? (
            <div>
              <pre className="text-[11px] whitespace-pre-wrap break-all text-[var(--foreground)] opacity-90">
                {contentTrunc!.truncated}
              </pre>
              {isProgram && action.result && (
                <div className="mt-1 border-l-2 border-[var(--border)] pl-2">
                  <span className="text-[10px] text-[var(--muted-foreground)]">output</span>
                  <pre className="text-[11px] whitespace-pre-wrap break-all text-[var(--foreground)] opacity-70">
                    {resultTrunc!.truncated}
                  </pre>
                </div>
              )}
              {/* program 路径：检测到 file_ops 编辑 → 在 output 下方追加 diff 卡片 */}
              {isProgram && hasDiff && (
                <div className="mt-1.5">
                  {diffEntries.map((e, i) => (
                    <EditDiffCard key={`${e.path}-${i}`} entry={e} />
                  ))}
                </div>
              )}
              {/* program 路径：plan_edits 结果 → 追加 EditPlanCard */}
              {isProgram && hasPlan && sessionId && planRef && (
                <EditPlanCard planId={planRef.planId} sessionId={sessionId} threadId={threadId} />
              )}
              {/* tool_use 路径：兜底覆盖 submit(command=plan_edits) result 直接含 planId 的场景 */}
              {isToolUse && hasPlan && sessionId && planRef && (
                <EditPlanCard planId={planRef.planId} sessionId={sessionId} threadId={threadId} />
              )}
              {needsModal && (
                <button
                  onClick={() => setModalOpen(true)}
                  className="mt-1 inline-flex items-center gap-1 text-[10px] text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
                >
                  <Maximize2 className="w-3 h-3" />
                  <span>查看全文</span>
                </button>
              )}
              {needsModal && (
                <FullTextModal
                  open={modalOpen}
                  onClose={() => setModalOpen(false)}
                  title={`${cfg.label} — ${objectName ?? ""}`}
                  content={action.content}
                  result={isProgram ? action.result : undefined}
                />
              )}
            </div>
          ) : isThinking ? (
            <div className="text-[var(--foreground)] opacity-70 italic">
              <MarkdownContent content={displayContent} className="text-[12px] leading-relaxed" />
            </div>
          ) : isInject && hasDiff ? (
            /* inject 路径：file_ops.editFile/writeFile/applyEdits 结果 → 用 diff 卡片替换原 JSON 文本 */
            <div>
              {diffEntries.map((e, i) => (
                <EditDiffCard key={`${e.path}-${i}`} entry={e} />
              ))}
              {hasPlan && sessionId && planRef && (
                <EditPlanCard planId={planRef.planId} sessionId={sessionId} threadId={threadId} />
              )}
            </div>
          ) : isInject && hasPlan && sessionId && planRef ? (
            /* inject 路径：plan_edits 结果 → 用 EditPlanCard 替换原 JSON 文本 */
            <EditPlanCard planId={planRef.planId} sessionId={sessionId} threadId={threadId} />
          ) : (
            <div className="text-[var(--foreground)] opacity-90">
              <MarkdownContent content={displayContent} className="text-[12px] leading-relaxed" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ================================================================
 *  TuiTalk — 替代 TalkCard（对象回复）
 * ================================================================ */

interface TuiTalkProps {
  msg: FlowMessage;
  loading?: boolean;
}

/** 剥离 talk 消息的内部元标记（[fork] / [form: form_xxx] 等），只保留可读正文
 *
 * LLM 视角的 message_out.content 会带 " [fork]" / " [form: form_xxx]" 尾缀，
 * 前端渲染时不应直接暴露给用户（Bruce 首轮 #14）。
 */
function stripTalkMeta(content: string): string {
  let body = content.trim();
  while (true) {
    const stripped = body.replace(/\s*\[(fork|continue|form)(?::?\s*[^\]]+)?\]\s*$/g, "").trim();
    if (stripped === body) break;
    body = stripped;
  }
  return body || content;
}

export function TuiTalk({ msg, loading }: TuiTalkProps) {
  const cleanContent = stripTalkMeta(msg.content);
  return (
    <div className="group font-mono text-[12px] leading-relaxed">
      {/* 头部行 */}
      <div className="flex items-baseline gap-1.5">
        <span className="shrink-0 select-none text-violet-400">❯</span>
        <span className="shrink-0 font-semibold text-violet-400">talk</span>
        <span className="text-[var(--muted-foreground)] opacity-60">{msg.from} → {msg.to}</span>
        {loading && <Loader2 className="w-3 h-3 animate-spin text-[var(--muted-foreground)]" />}
        <span className="text-[var(--muted-foreground)] opacity-40 shrink-0 ml-auto">{formatTs(msg.timestamp)}</span>
        <CopyBtn text={cleanContent} />
      </div>

      {/* 内容（已剥离 [fork] / [form: xxx] 等内部元标记） */}
      <div className="pl-5 mt-0.5">
        <MarkdownContent content={cleanContent} className="text-[13px] leading-relaxed" />
      </div>
    </div>
  );
}

/* ================================================================
 *  TuiUserMessage — 替代 MessageBubble（用户输入）
 * ================================================================ */

interface TuiUserMessageProps {
  msg: FlowMessage;
}

export function TuiUserMessage({ msg }: TuiUserMessageProps) {
  return (
    <div className="group font-mono text-[12px] leading-relaxed">
      <div className="flex items-baseline gap-1.5">
        <span className="shrink-0 select-none text-[var(--foreground)]">&gt;</span>
        <span className="text-[var(--foreground)]">{msg.content}</span>
        <span className="text-[var(--muted-foreground)] opacity-40 shrink-0 ml-auto">{formatTs(msg.timestamp)}</span>
      </div>
    </div>
  );
}

/* ================================================================
 *  TuiStreamingBlock — 流式输出占位（SSE 正在输出时）
 * ================================================================ */

interface TuiStreamingBlockProps {
  type: string;
  content: string;
  objectName?: string;
}

export function TuiStreamingBlock({ type, content, objectName }: TuiStreamingBlockProps) {
  const cfg = TYPE_CONFIG[type] ?? DEFAULT_CONFIG;

  return (
    <div className="font-mono text-[12px] leading-relaxed animate-pulse">
      <div className="flex items-baseline gap-1.5">
        <span className={cn("shrink-0 select-none", cfg.color)}>{cfg.prefix}</span>
        <span className={cn("shrink-0 font-semibold", cfg.color)}>{cfg.label}</span>
        {objectName && (
          <span className="text-[var(--muted-foreground)] opacity-60">{objectName}</span>
        )}
        <Loader2 className="w-3 h-3 animate-spin text-[var(--muted-foreground)]" />
      </div>
      <div className="pl-5 mt-0.5">
        {type === "thinking" ? (
          <div className="text-[var(--foreground)] opacity-70 italic">
            <MarkdownContent content={content} className="text-[12px] leading-relaxed" />
          </div>
        ) : type === "program" ? (
          <pre className="text-[11px] whitespace-pre-wrap break-all text-[var(--foreground)] opacity-90">{content}</pre>
        ) : (
          <MarkdownContent content={content} className="text-[12px] leading-relaxed" />
        )}
      </div>
    </div>
  );
}
