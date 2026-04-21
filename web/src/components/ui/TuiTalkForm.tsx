/**
 * TuiTalkForm — 渲染带 form 的 talk 消息为 option picker
 *
 * 设计参考 Claude Code 的 option picker：
 * - 顶部问题（talk 的 message）
 * - 编号选项列表（1, 2, 3, ...）
 * - 自由文本输入框（"Something else"）+ Skip 按钮
 * - 键盘：↑↓ 导航、Enter 选中/发送、Esc 跳过
 * - 鼠标：单选点击即发；多选勾选后确认按钮发送
 *
 * 组件自己管理焦点与键盘；MessageSidebar 只负责传入 form + onSubmit 回调。
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { cn } from "../../lib/utils";
import { MarkdownContent } from "./MarkdownContent";
import { Loader2, Check, SkipForward } from "lucide-react";
import type { TalkFormPayload, FormResponse, FlowMessage } from "../../api/types";

/* ── 时间格式化 ── */
function formatTs(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/** 提交状态枚举（用于禁用 UI + 显示 loading） */
type SubmitState = "idle" | "submitting" | "submitted";

interface TuiTalkFormProps {
  /** 原 talk 消息（用于拿 from/to/content/timestamp） */
  msg: FlowMessage;
  /** 结构化表单（含 formId + options） */
  form: TalkFormPayload;
  /**
   * 提交回调（用户选完/输入完触发）
   *
   * 返回 Promise：resolve 后 UI 切到 "submitted" 态，禁用输入
   */
  onSubmit: (response: FormResponse) => Promise<void>;
  /** 该 form 是否已被提交过（持久化判断：比如刷新后还在看同一条消息） */
  alreadySubmitted?: boolean;
}

export function TuiTalkForm({ msg, form, onSubmit, alreadySubmitted }: TuiTalkFormProps) {
  const isMulti = form.type === "multi_choice";
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [freeText, setFreeText] = useState("");
  /** 键盘导航高亮索引：0..options.length = 选项 1..n；options.length = 自由文本框 */
  const [cursor, setCursor] = useState<number>(0);
  const [submitState, setSubmitState] = useState<SubmitState>(alreadySubmitted ? "submitted" : "idle");
  const containerRef = useRef<HTMLDivElement>(null);
  const freeTextRef = useRef<HTMLInputElement>(null);

  const totalSlots = form.options.length + 1; /* +1 for free text row */
  const freeTextSlot = form.options.length;   /* index for free-text row */

  /* 挂载时请求焦点，键盘事件才能响应 */
  useEffect(() => {
    if (submitState === "idle") containerRef.current?.focus();
  }, [submitState]);

  /* 同步 cursor 到 ↑↓/1..n 数字键激活光标 */
  const moveCursor = useCallback((dir: "up" | "down") => {
    setCursor((prev) => {
      if (dir === "up") return prev <= 0 ? totalSlots - 1 : prev - 1;
      return prev >= totalSlots - 1 ? 0 : prev + 1;
    });
  }, [totalSlots]);

  /* 实际提交（封装 async state 切换） */
  const doSubmit = useCallback(async (response: FormResponse) => {
    if (submitState !== "idle") return;
    setSubmitState("submitting");
    try {
      await onSubmit(response);
      setSubmitState("submitted");
    } catch (err) {
      console.error("TuiTalkForm submit failed:", err);
      setSubmitState("idle"); /* 允许重试 */
    }
  }, [onSubmit, submitState]);

  /** 单选：点击即发 */
  const handleSelectOption = useCallback((optionId: string) => {
    if (submitState !== "idle") return;
    if (isMulti) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(optionId)) next.delete(optionId);
        else next.add(optionId);
        return next;
      });
    } else {
      /* 单选：点击即发 */
      void doSubmit({
        formId: form.formId,
        selectedOptionIds: [optionId],
        freeText: null,
      });
    }
  }, [isMulti, doSubmit, form.formId, submitState]);

  /** 多选确认按钮 */
  const handleMultiConfirm = useCallback(() => {
    if (submitState !== "idle") return;
    if (selectedIds.size === 0 && !freeText.trim()) return;
    void doSubmit({
      formId: form.formId,
      selectedOptionIds: Array.from(selectedIds),
      freeText: freeText.trim() || null,
    });
  }, [doSubmit, form.formId, selectedIds, freeText, submitState]);

  /** 自由文本提交（按 Enter） */
  const handleFreeTextSubmit = useCallback(() => {
    if (submitState !== "idle") return;
    const text = freeText.trim();
    if (!text) return;
    void doSubmit({
      formId: form.formId,
      selectedOptionIds: isMulti ? Array.from(selectedIds) : [],
      freeText: text,
    });
  }, [doSubmit, form.formId, freeText, isMulti, selectedIds, submitState]);

  /** Esc 跳过（什么都不发） */
  const handleSkip = useCallback(() => {
    if (submitState !== "idle") return;
    setSubmitState("submitted");
  }, [submitState]);

  /** 容器级键盘处理 */
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (submitState !== "idle") return;
    /* 自由文本框内部——让它自己处理 */
    if (document.activeElement === freeTextRef.current) {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleFreeTextSubmit();
      }
      if (e.key === "Escape") {
        e.preventDefault();
        freeTextRef.current?.blur();
        containerRef.current?.focus();
      }
      return;
    }

    if (e.key === "ArrowDown") { e.preventDefault(); moveCursor("down"); return; }
    if (e.key === "ArrowUp")   { e.preventDefault(); moveCursor("up");   return; }
    if (e.key === "Escape")    { e.preventDefault(); handleSkip();       return; }

    /* 数字键 1..9 直接选对应选项 */
    if (/^[1-9]$/.test(e.key)) {
      const idx = Number(e.key) - 1;
      if (idx < form.options.length) {
        e.preventDefault();
        setCursor(idx);
        handleSelectOption(form.options[idx]!.id);
      }
      return;
    }

    if (e.key === "Enter") {
      e.preventDefault();
      if (cursor === freeTextSlot) {
        /* 聚焦自由文本框 */
        freeTextRef.current?.focus();
      } else if (cursor < form.options.length) {
        if (isMulti) {
          handleSelectOption(form.options[cursor]!.id);
        } else {
          handleSelectOption(form.options[cursor]!.id);
        }
      }
    }
  }, [cursor, freeTextSlot, handleFreeTextSubmit, handleSelectOption, handleSkip, form.options, isMulti, moveCursor, submitState]);

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className={cn(
        "group font-mono text-[12px] leading-relaxed outline-none",
        submitState !== "idle" && "opacity-60 pointer-events-none",
      )}
    >
      {/* 头部行（与 TuiTalk 风格一致） */}
      <div className="flex items-baseline gap-1.5">
        <span className="shrink-0 select-none text-violet-400">❯</span>
        <span className="shrink-0 font-semibold text-violet-400">talk · form</span>
        <span className="text-[var(--muted-foreground)] opacity-60">{msg.from} → {msg.to}</span>
        {submitState === "submitting" && <Loader2 className="w-3 h-3 animate-spin text-[var(--muted-foreground)]" />}
        {submitState === "submitted" && <Check className="w-3 h-3 text-green-500" />}
        <span className="text-[var(--muted-foreground)] opacity-40 shrink-0 ml-auto">{formatTs(msg.timestamp)}</span>
      </div>

      {/* 问题正文 */}
      <div className="pl-5 mt-0.5 mb-2">
        <MarkdownContent content={msg.content.replace(/\s*\[form:[^\]]+\]\s*$/, "")} className="text-[13px] leading-relaxed" />
      </div>

      {/* 选项列表 */}
      <div className="pl-5 space-y-1">
        {form.options.map((opt, i) => {
          const isSelected = selectedIds.has(opt.id);
          const isCursor = cursor === i;
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => handleSelectOption(opt.id)}
              onMouseEnter={() => setCursor(i)}
              disabled={submitState !== "idle"}
              className={cn(
                "flex items-start gap-2 w-full text-left px-2 py-1 rounded transition-colors",
                isCursor && "bg-[var(--accent)]",
                isSelected && "bg-[var(--accent)]/70",
              )}
            >
              <span className={cn(
                "shrink-0 w-5 text-center font-semibold",
                isCursor ? "text-[var(--foreground)]" : "text-[var(--muted-foreground)]",
              )}>
                {i + 1}.
              </span>
              {isMulti && (
                <span className={cn(
                  "shrink-0 inline-flex items-center justify-center w-4 h-4 rounded border text-[10px] mt-0.5",
                  isSelected ? "bg-[var(--primary)] border-[var(--primary)] text-[var(--primary-foreground)]" : "border-[var(--border)]",
                )}>
                  {isSelected ? "✓" : ""}
                </span>
              )}
              <span className="flex-1 min-w-0">
                <span className="text-[var(--foreground)]">{opt.label}</span>
                {opt.detail && (
                  <span className="block text-[11px] text-[var(--muted-foreground)] opacity-75 mt-0.5">{opt.detail}</span>
                )}
              </span>
            </button>
          );
        })}

        {/* 自由文本 + skip */}
        <div
          onMouseEnter={() => setCursor(freeTextSlot)}
          className={cn(
            "flex items-center gap-2 px-2 py-1 rounded transition-colors",
            cursor === freeTextSlot && "bg-[var(--accent)]",
          )}
        >
          <span className={cn(
            "shrink-0 w-5 text-center font-semibold",
            cursor === freeTextSlot ? "text-[var(--foreground)]" : "text-[var(--muted-foreground)]",
          )}>
            ›
          </span>
          <input
            ref={freeTextRef}
            type="text"
            value={freeText}
            onChange={(e) => setFreeText(e.target.value)}
            onFocus={() => setCursor(freeTextSlot)}
            placeholder="Something else…（Enter 发送，Esc 取消）"
            disabled={submitState !== "idle"}
            className="flex-1 bg-transparent text-[12px] outline-none text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] min-w-0"
          />
          {isMulti && selectedIds.size > 0 && (
            <button
              type="button"
              onClick={handleMultiConfirm}
              disabled={submitState !== "idle"}
              className="shrink-0 px-2 py-0.5 rounded bg-[var(--primary)] text-[var(--primary-foreground)] text-[11px] hover:opacity-90"
              title="发送选中项"
            >
              确认 ({selectedIds.size})
            </button>
          )}
          <button
            type="button"
            onClick={handleSkip}
            disabled={submitState !== "idle"}
            className="shrink-0 inline-flex items-center gap-1 text-[11px] text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
            title="跳过（Esc）"
          >
            <SkipForward className="w-3 h-3" />
            <span>Skip</span>
          </button>
        </div>
      </div>

      {/* 提交后提示 */}
      {submitState === "submitted" && (
        <div className="pl-5 mt-2 text-[10px] text-[var(--muted-foreground)] italic">
          已回复
        </div>
      )}
    </div>
  );
}
