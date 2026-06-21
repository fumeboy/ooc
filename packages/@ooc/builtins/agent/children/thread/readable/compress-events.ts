/**
 * compress v2 协议 —— thread 窗的 `resize` / `compress`（class 自实现，无通用默认）。
 *
 * - `resize`：设 `autoCompressLevel`（自动压缩档位/阈值）——thread 窗自视渲句柄、无展示档位，故 resize
 *   在 thread 窗调的是「自动压缩灵敏度」。替代旧 expand 的「调档」语义。
 * - `compress`：**无参意图**——置 `win.compressIntent=true` 请求「现在压一次」。框架 auto-trigger hook
 *   消费 intent → fork 一条 summarizer 子线程读早期 transcript 生成摘要 → harvest 折入
 *   `win.summarizedRanges`（compress-fork.ts / scheduler.ts）。摘要由 **fork 生成**（非 agent 自写）。
 *
 * 折叠态 `win.summarizedRanges` 随 inline thread 窗持久化、读出侧 `projectSummarizedRanges` 投影、
 * thread.events 一字不改。两方法都是纯 window method（只动 win、零副作用）；真正的 fork 副作用由
 * thinkloop framework hook 据 win 态执行（window method 不 spawn fork）。
 */
import type { WindowMethod } from "@ooc/core/readable/contract.js";

interface ThreadCompressWin {
  autoCompressLevel?: 0 | 1 | 2;
  compressIntent?: boolean;
}

const clampLevel = (n: number): 0 | 1 | 2 => Math.max(0, Math.min(2, n)) as 0 | 1 | 2;

/** thread 窗 compress：无参意图——置 compressIntent，框架据此 fork summarizer 折早期历史。 */
export const threadCompress: WindowMethod<unknown, ThreadCompressWin> = {
  name: "compress",
  description:
    "压缩本 thread 历史：表达「现在压一次」的意图（无参）。框架会 fork 一条子线程把早期过程浓缩成一条摘要、" +
    "折叠呈现（原始 events 不丢、可在对象窗回查关键状态）。要调整自动压缩的激进程度，用 resize。",
  schema: { args: {} },
  exec: (_ctx, _self, before_win) => {
    return { ...before_win, compressIntent: true };
  },
};

/** thread 窗 resize：设自动压缩档位 autoCompressLevel（0 不主动 / 1 适度 / 2 激进）。 */
export const threadResize: WindowMethod<unknown, ThreadCompressWin> = {
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
    return { ...before_win, autoCompressLevel: clampLevel(typeof raw === "number" ? raw : 0) };
  },
};
