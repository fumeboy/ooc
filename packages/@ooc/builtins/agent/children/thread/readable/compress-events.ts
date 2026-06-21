/**
 * thread 窗专属 compress/expand —— events 折叠的**能力归属**（compress.md 核心 7）。
 *
 * 通用默认表（core/readable/default-window-methods.ts）只管 scope=windows（展示档位）；scope=events
 * （折叠 thread 历史 transcript）归「内容所在的窗」= thread 窗，由本文件声明、在 thread readable 的
 * window[] 里覆盖默认表。这样 agent 只在 thread 窗菜单看到 events 折叠 → 只能 window_id=thread 窗 调它
 * → 折叠态落对窗（thread 窗 win.summarizedRanges，读出侧 buildInputItems self 视角折 thread.events /
 * conversation-render peer 视角折 messages）。写读对齐成能力归属的自然结果。
 *
 * 折叠态在 win（视角独立、随 THREAD_CLASS_ID inline 整窗持久化），thread.events 一字不改 → 可逆。
 */
import type { ReadableContext, WindowMethod } from "@ooc/core/readable/contract.js";
import {
  addSummarizedRange,
  removeSummarizedRange,
  type WinWithSummarizedRanges,
} from "@ooc/core/_shared/utils/summarized-ranges.js";

interface ThreadCompressWin extends WinWithSummarizedRanges {
  compressLevel?: 0 | 1 | 2;
}

interface EventsArgs {
  scope?: "windows" | "events";
  keepTail?: number;
  fromIdx?: number;
  toIdx?: number;
  summary?: string;
  at?: number;
}

const clampLevel = (n: number): 0 | 1 | 2 => Math.max(0, Math.min(2, n)) as 0 | 1 | 2;

/**
 * scope=events 折叠：往 `summarizedRanges` 追加一段。
 * - `fromIdx`/`toIdx`：点名 event index 区间（含两端）。
 * - `keepTail=N`：保留末 N 条、其余折成一段——self transcript 长度取 `ctx.thread.events.length`。
 * 没有可折的（keepTail≥总数 / 空区段）→ 原样返回（幂等空操作，不报错）。
 */
function foldEvents(
  ctx: ReadableContext,
  before_win: ThreadCompressWin,
  args: EventsArgs,
): ThreadCompressWin {
  let fromIdx: number;
  let toIdx: number;
  if (typeof args.fromIdx === "number" && typeof args.toIdx === "number") {
    fromIdx = args.fromIdx;
    toIdx = args.toIdx;
  } else if (typeof args.keepTail === "number") {
    const total = ctx.thread?.events?.length ?? 0;
    const keep = Math.max(0, Math.floor(args.keepTail));
    fromIdx = 0;
    toIdx = total - 1 - keep;
  } else {
    throw new Error(
      "[compress scope=events] 需 keepTail=N（保留末 N 条）或 fromIdx/toIdx 点名折叠区段",
    );
  }
  if (toIdx < fromIdx) return before_win ?? {};
  const summary =
    typeof args.summary === "string" && args.summary.trim().length > 0
      ? args.summary
      : "(no summary provided)";
  return {
    ...before_win,
    summarizedRanges: addSummarizedRange(before_win?.summarizedRanges, {
      fromIdx,
      toIdx,
      summary,
    }),
  };
}

/** thread 窗 compress：scope=events（默认，本窗主用）折历史；scope=windows 折展示档位。 */
export const threadCompress: WindowMethod<unknown, ThreadCompressWin> = {
  name: "compress",
  description:
    "折叠本 thread 历史 transcript（scope=events，默认）：keepTail=N 保留末 N 条其余折成一条摘要，" +
    "或 fromIdx/toIdx 点名区段；summary 你自己写（折叠后替换原始 events，原文不丢、可 expand 还原）。" +
    "scope=windows：折本窗展示档位。",
  schema: {
    args: {
      scope: {
        type: "string",
        required: false,
        enum: ["windows", "events"],
        default: "events",
        description: "events（默认）=折本 thread 历史 transcript；windows=折本窗展示档位",
      },
      keepTail: {
        type: "number",
        required: false,
        description: "scope=events：保留末 N 条 event，其余折成一条摘要",
      },
      fromIdx: {
        type: "number",
        required: false,
        description: "scope=events：被折区段起点 event index（含；与 keepTail 互斥）",
      },
      toIdx: {
        type: "number",
        required: false,
        description: "scope=events：被折区段终点 event index（含）",
      },
      summary: {
        type: "string",
        required: false,
        description: "scope=events：该区段摘要文本（折叠后替换原始 events）",
      },
    },
  },
  exec: (ctx, _self, before_win, args) => {
    const a = (args ?? {}) as EventsArgs;
    if (a.scope === "windows") {
      return { ...before_win, compressLevel: clampLevel((before_win?.compressLevel ?? 0) + 1) };
    }
    return foldEvents(ctx, before_win, a); // 默认 events（thread 窗主用途）
  },
};

/** thread 窗 expand：scope=events（默认）展开折叠；scope=windows 展开展示档位。 */
export const threadExpand: WindowMethod<unknown, ThreadCompressWin> = {
  name: "expand",
  description:
    "展开本 thread 历史折叠（scope=events，默认）：at=index 展开覆盖该 event index 的那段，不给 at 则清空全部折叠。" +
    "scope=windows：展本窗展示档位。",
  schema: {
    args: {
      scope: {
        type: "string",
        required: false,
        enum: ["windows", "events"],
        default: "events",
        description: "events（默认）=展本 thread 历史折叠；windows=展本窗展示档位",
      },
      at: {
        type: "number",
        required: false,
        description: "scope=events：展开覆盖该 event index 的那段；不给则清空全部折叠",
      },
    },
  },
  exec: (_ctx, _self, before_win, args) => {
    const a = (args ?? {}) as EventsArgs;
    if (a.scope === "windows") {
      return { ...before_win, compressLevel: clampLevel((before_win?.compressLevel ?? 0) - 1) };
    }
    return {
      ...before_win,
      summarizedRanges: removeSummarizedRange(before_win?.summarizedRanges, a.at),
    };
  },
};

interface ThreadResizeWin {
  autoCompressLevel?: 0 | 1 | 2;
}

/**
 * compress v2 —— thread 窗 `resize`：设**自动压缩档位** `autoCompressLevel`（0 不主动 / 1 适度 / 2 激进）。
 * thread 窗自视渲句柄、无展示档位（compressLevel 不用），故 resize 在 thread 窗调的是「自动压缩灵敏度」：
 * 未总结 transcript 超该档对应阈值（autoCompressThreshold）时，框架自动 fork 一条子线程生成摘要、折叠早期过程。
 * 纯设态（window method 契约：只动 win、零副作用）；实际 fork 由 thinkloop framework hook 据此档位触发。
 */
export const threadResize: WindowMethod<unknown, ThreadResizeWin> = {
  name: "resize",
  description:
    "调本 thread 窗的自动压缩档位 level：0=不主动压缩，1=适度，2=激进（越高越早自动折叠早期历史）。" +
    "超阈值时框架 fork 子线程生成摘要、折叠早期过程，不丢原文。",
  schema: {
    args: {
      level: {
        type: "number",
        required: true,
        enum: [0, 1, 2],
        description: "自动压缩档位：0 不主动 / 1 适度 / 2 激进",
      },
    },
  },
  exec: (_ctx, _self, before_win, args) => {
    const raw = (args as { level?: number } | undefined)?.level;
    const lvl = clampLevel(typeof raw === "number" ? raw : 0);
    return { ...before_win, autoCompressLevel: lvl };
  },
};
