/**
 * base/program/executable — program 原型的 behavior 真源（OOC-4 L4.2c）。
 *
 * methods（exec/close/set_history_window）+ renderXml + 内部 executeProgramWindowExec 的**实现**住这里
 * （物理 move 自 windows/program/index.ts），由活路径沿 base 原型链解析
 * （src/executable/windows/_shared/behavior.ts）。
 *
 * **留 windows（被 root 创建器命令 + tools/wait 用 = 跨域共享）**，本文件 import 之：
 * - windows/program/runtime.ts（runOneExec / ProgramExecArgs）
 * - windows/program/history-viewport.ts（DEFAULT_HISTORY_VIEWPORT / executeProgramSetHistoryViewport /
 *   hasAnyHistoryViewportField）
 *
 * program 无 basicKnowledge（method-level knowledge 由各 entry.knowledge() 派生），无 onClose / compressView，
 * 故 windows/program/index.ts 薄壳只 register `{}` + markRenderXmlViaPrototype。
 */

import type { ObjectWindowDefinition } from "../../../../executable/server/window-types.js";
import type {
  MethodExecutionContext,
  MethodKnowledgeEntries,
  MethodEntry,
} from "../../../../executable/windows/_shared/method-types.js";
import type { RenderContext } from "../../../../executable/windows/_shared/registry.js";
import {
  runOneExec,
  type ProgramExecArgs,
} from "../../../../executable/windows/program/runtime.js";
import type { ProgramWindow } from "../../../../executable/windows/_shared/types.js";
import {
  xmlElement,
  xmlText,
  xmlComment,
  truncateBytes,
  type XmlNode,
} from "../../../../thinkable/context/xml.js";
import {
  applyTranscriptViewport,
  type TranscriptViewport,
} from "../../../../executable/windows/_shared/transcript-viewport.js";
import {
  DEFAULT_HISTORY_VIEWPORT,
  executeProgramSetHistoryViewport,
  hasAnyHistoryViewportField,
} from "../../../../executable/windows/program/history-viewport.js";

const PROGRAM_WINDOW_EXEC_BASIC = "internal/windows/program/exec/basic";
const PROGRAM_WINDOW_EXEC_INPUT = "internal/windows/program/exec/input";
const PROGRAM_WINDOW_CLOSE_BASIC = "internal/windows/program/close/basic";
const PROGRAM_WINDOW_SET_HISTORY_BASIC = "internal/windows/program/set_history_window/basic";
const PROGRAM_WINDOW_SET_HISTORY_INPUT = "internal/windows/program/set_history_window/input";

const EXEC_KNOWLEDGE = `
program_window.exec 用于在已打开的 program_window 中再次执行一段 shell / ts / js 代码。

参数（与 root.program 相同）：
- language: shell / ts / js（与 code 配合，必填）
- code: 待执行代码字符串（必填）

每次 exec 都是独立 sandbox：
- shell：起新进程
- ts/js：每次新加载用户代码模块；可通过 self.getThreadLocal/setThreadLocal 跨 exec 共享数据；
  ts/js 内仍可 \`await self.callCommand("custom:<self>", "<name>", {...})\` 调命令

执行结果会追加到 program_window.history；窗口本身保留打开。

要调任意 window 上的命令请直接用顶层 \`exec\` tool；program_window.exec 只用来跑代码。

渲染层默认按 historyViewport={ tail: 10 } 只展示末 10 次 exec；\`<history_viewport total=N tail=10 earlier_omitted=M/>\`
元节点暴露省略数；想看其它区间用 set_history_window；last_output 始终是最近一次 exec（不受 viewport 影响）。
`.trim();

const CLOSE_KNOWLEDGE = `
program_window.close 等价于 close tool；释放 window 与 history。
不会停止任何外部进程（每次 exec 都已经结束）。
`.trim();

const SET_HISTORY_KNOWLEDGE = `
program_window.set_history_window 精细化调整 exec history 渲染视口。

打开 program_window 时默认 historyViewport = { tail: 10 } —— 只渲染末 10 次 exec；
更早的 exec 以 \`<history_viewport tail=10 total=42 earlier_omitted=32/>\` 形式提示前部还有多少条。

参数（**择一传**，二选一）：
- history_tail: 末 N 次（必须是正整数）
- history_start + history_end: 固定区间 history[history_start, history_end)（非负整数；history_start ≤ history_end；必须同时出现）

**history_tail 与 history_start/history_end 互斥**：传 history_tail 的 args 清空 range；传 range 的 args 清空 tail。

约束（fail-loud）：
- history_tail 必须是正整数（>= 1）
- history_start / history_end 必须是非负整数
- history_start ≤ history_end
- history_start 与 history_end 必须同时出现

例：
- exec(window_id="<id>", method="set_history_window", args={ history_tail: 30 })          → 看末 30 次 exec
- exec(..., args={ history_start: 0, history_end: 5 })                                     → 看前 5 次
- exec(..., args={ history_start: 10, history_end: 20 })                                   → 看中间 10 次

**注意**：viewport 只影响**渲染**给 LLM 的 history summary 与 last_output 锚点；
后续 exec 仍正常追加到完整 history（不受 viewport 影响）。
`.trim();

export const execCommand: MethodEntry = {
  paths: ["exec", "exec.shell", "exec.ts", "exec.js"],
  match: (args) => {
    const hit: string[] = ["exec"];
    const lang = (args.language ?? args.lang) as string | undefined;
    if (lang === "shell") hit.push("exec.shell");
    if (lang === "ts" || lang === "typescript") hit.push("exec.ts");
    if (lang === "js" || lang === "javascript") hit.push("exec.js");
    return hit;
  },
  knowledge: (args, formStatus): MethodKnowledgeEntries => {
    const entries: MethodKnowledgeEntries = { [PROGRAM_WINDOW_EXEC_BASIC]: EXEC_KNOWLEDGE };
    if (formStatus !== "open") return entries;
    const lang = (args.language ?? args.lang) as string | undefined;
    const code = typeof args.code === "string" ? args.code.trim() : "";
    if (!(lang && code)) {
      entries[PROGRAM_WINDOW_EXEC_INPUT] =
        "program_window.exec 缺少执行参数；refine(args={ language, code })。";
    }
    return entries;
  },
  exec: (ctx) => executeProgramWindowExec(ctx),
};

export const closeCommand: MethodEntry = {
  paths: ["close"],
  match: () => ["close"],
  knowledge: (): MethodKnowledgeEntries => ({ [PROGRAM_WINDOW_CLOSE_BASIC]: CLOSE_KNOWLEDGE }),
  exec: () => undefined,
};

export const setHistoryWindowCommand: MethodEntry = {
  paths: ["set_history_window"],
  match: () => ["set_history_window"],
  knowledge: (args, formStatus): MethodKnowledgeEntries => {
    const entries: MethodKnowledgeEntries = {
      [PROGRAM_WINDOW_SET_HISTORY_BASIC]: SET_HISTORY_KNOWLEDGE,
    };
    if (formStatus === "open" && !hasAnyHistoryViewportField(args)) {
      entries[PROGRAM_WINDOW_SET_HISTORY_INPUT] =
        "set_history_window 至少需要传入 history_tail / history_start+history_end 之一。\n" +
        "history_tail 与 history_start/history_end 互斥，请 refine 后 submit。";
    }
    return entries;
  },
  exec: (ctx) => executeProgramSetHistoryViewport(ctx),
};

/** program_window.exec：跑一次 exec，把 record append 到 window.history。 */
export async function executeProgramWindowExec(
  ctx: MethodExecutionContext,
): Promise<string | undefined> {
  const thread = ctx.thread;
  if (!thread) return "[program_window.exec] 缺少 thread context。";
  const window = ctx.parentWindow;
  if (!window || window.type !== "program") {
    return "[program_window.exec] 未挂载在 program_window 上。";
  }

  const args: ProgramExecArgs = {
    language: ctx.args.language as ProgramExecArgs["language"],
    code: ctx.args.code as string | undefined,
  };
  if (!(args.language && args.code)) {
    return "[program_window.exec] 缺少执行参数。请重新 exec(window_id=\"<program_window_id>\", method=\"exec\", args={ language: \"shell\"|\"ts\"|\"js\", code: \"...\" }) 一次性给齐参数。";
  }
  const record = await runOneExec(thread, args);

  // 把 record 追加到 window.history；通过 manager 重新插入以保证 toData() 写回
  if (ctx.manager) {
    const next: ProgramWindow = {
      ...window,
      history: [...window.history, record],
    };
    Object.assign(window, next);
  } else {
    window.history.push(record);
  }
  return undefined;
}

/** program_window 的 renderXml hook：history 摘要（按 historyViewport 截取）+ 最近一条 full output。 */
export function renderProgramWindow(ctx: RenderContext): XmlNode[] {
  const window = ctx.window as ProgramWindow;
  const children: XmlNode[] = [];
  if (window.history.length === 0) {
    children.push(xmlComment("(no exec yet)"));
    return children;
  }

  const viewport: TranscriptViewport =
    window.historyViewport ?? DEFAULT_HISTORY_VIEWPORT;
  // 按完整 history 的下标渲染（保留绝对 index n），但只对 visible 子集生成 summary 节点。
  const indexed = window.history.map((rec, idx) => ({ rec, idx }));
  const { visible, earlierCount } = applyTranscriptViewport(indexed, viewport);

  // 始终暴露 history_viewport 元节点（让 LLM 知道当前可见区间 + 前部省略数）
  const viewportAttrs: Record<string, string> = {
    total: String(window.history.length),
  };
  if (typeof viewport.tail === "number") {
    viewportAttrs.tail = String(viewport.tail);
  } else if (
    typeof viewport.rangeStart === "number" &&
    typeof viewport.rangeEnd === "number"
  ) {
    viewportAttrs.history_start = String(viewport.rangeStart);
    viewportAttrs.history_end = String(viewport.rangeEnd);
  }
  if (earlierCount > 0) {
    viewportAttrs.earlier_omitted = String(earlierCount);
  }
  children.push(xmlElement("history_viewport", viewportAttrs));

  const summary = visible.map(({ rec, idx }) =>
    xmlElement(
      "exec",
      { id: rec.execId, n: String(idx), kind: rec.language, ok: rec.ok ? "ok" : "fail" },
      [],
    ),
  );
  children.push(xmlElement("history", {}, summary));

  // last_output 始终用完整 history 的最后一条（不受 viewport 影响）——
  // 最近一次 exec 是 LLM 最常需要的反馈锚点，viewport 只截"summary 列表"
  const last = window.history[window.history.length - 1]!;
  children.push(
    xmlElement(
      "last_output",
      { exec_id: last.execId },
      [xmlText(truncateBytes(last.output))],
    ),
  );
  return children;
}

export const window: ObjectWindowDefinition = {
  methods: {
    exec: execCommand,
    close: closeCommand,
    set_history_window: setHistoryWindowCommand,
  },
  renderXml: renderProgramWindow,
};
