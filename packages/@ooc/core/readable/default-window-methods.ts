/**
 * 默认 window method —— 挂在**所有 window 公共层**的缺省方法表。
 *
 * 背景：window method 此前只能由各 class 在 `readable.window[].window_methods` 自行声明
 * （`resolveWindowMethod` 仅查 class 自有声明）。compress/expand 这类**对任何 window 都通用**的
 * 折叠/展开能力若依赖各 class 各自实现，必然「各自实现 ⇒ 无人实现」。故提供一张默认表：
 * `resolveWindowMethod` 在 class 自有声明未命中时回退此表（class 同名仍优先，可 override）。
 *
 * 契约同 {@link WindowMethod}：纯函数 `(ctx, self, before_win, args) => 新 win`，只动投影态、零副作用。
 * compress/expand 两个 scope 复用同一 method、统一语义、零派发冲突：
 * - `scope=windows`（默认）：调单窗的展示**档位**（`compressLevel` 0|1|2）——读出侧
 *   `xml.ts:projectByCompressLevel` 按档位投影（0 全文 / 1 缩略 / 2 仅句柄）。
 * - `scope=events`：折叠本 thread **历史 transcript** 一段为摘要（`summarizedRanges`，
 *   `{fromIdx,toIdx,summary}` 投影态）——读出侧 self 视角 `context/index.ts` 折 `thread.events`、
 *   peer 视角 `conversation-render.ts` 折 messages，落段内 items 替换为一条 summary 占位。
 *   折叠态在 win（视角独立、可持久化），`thread.events` 一字不改 → 可逆（expand 即还原）。
 */
import type { ReadableContext, WindowMethod } from "./contract.js";
import {
  addSummarizedRange,
  removeSummarizedRange,
  type WinWithSummarizedRanges,
} from "../_shared/utils/summarized-ranges.js";

/** compressLevel 投影档位上限：0 全文 / 1 缩略 / 2 仅句柄。 */
export const MAX_COMPRESS_LEVEL = 2;

interface CompressWin extends WinWithSummarizedRanges {
  compressLevel?: 0 | 1 | 2;
}

/** scope=events 的折叠/展开 args。 */
interface EventsCompressArgs {
  scope?: "windows" | "events";
  keepTail?: number;
  fromIdx?: number;
  toIdx?: number;
  summary?: string;
  at?: number;
}

function clampLevel(n: number): 0 | 1 | 2 {
  return Math.max(0, Math.min(MAX_COMPRESS_LEVEL, n)) as 0 | 1 | 2;
}

/**
 * scope=events 折叠：往 `summarizedRanges` 追加一段。区段坐标：
 * - `fromIdx`/`toIdx`：点名 event index 区间（含两端；精准清噪声 tool 结果）。
 * - `keepTail=N`：保留末 N 条、其余（最早 → 倒数第 N+1）折成一段——self transcript 长度取
 *   `ctx.thread.events.length`（self 窗即本 thread）。
 * 没有可折的（keepTail≥总数 / 区段为空）→ 原样返回（幂等空操作，不报错）。
 */
function compressEvents(
  ctx: ReadableContext,
  before_win: CompressWin,
  args: EventsCompressArgs,
): CompressWin {
  let fromIdx: number;
  let toIdx: number;
  if (typeof args.fromIdx === "number" && typeof args.toIdx === "number") {
    fromIdx = args.fromIdx;
    toIdx = args.toIdx;
  } else if (typeof args.keepTail === "number") {
    // keepTail：self transcript 长度取 ctx.thread.events.length（self 窗即本 thread）。
    const total = ctx.thread?.events?.length ?? 0;
    const keep = Math.max(0, Math.floor(args.keepTail));
    fromIdx = 0;
    toIdx = total - 1 - keep;
  } else {
    throw new Error(
      "[compress scope=events] 需 keepTail=N（保留末 N 条）或 fromIdx/toIdx 点名折叠区段",
    );
  }
  if (toIdx < fromIdx) return before_win ?? {}; // 没有可折的（keepTail≥总数 / 空区段）→ 幂等空操作
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

/** compress：scope=windows 调高档位一档（封顶 2）；scope=events 折叠一段历史。纯投影态变更。 */
const compress: WindowMethod<unknown, CompressWin> = {
  name: "compress",
  description:
    "折叠展示。scope=windows（默认）：本窗折一档（0 全文→1 缩略→2 仅句柄）。" +
    "scope=events：折叠本 thread 历史 transcript——keepTail=N 保留末 N 条其余折成一条摘要，" +
    "或 fromIdx/toIdx 点名区段；summary 你自己写（折叠后用它替换原始 events，原文不丢、可 expand 还原）。",
  schema: {
    args: {
      scope: {
        type: "string",
        required: false,
        enum: ["windows", "events"],
        default: "windows",
        description: "windows=折本窗展示档位；events=折本 thread 历史 transcript",
      },
      keepTail: {
        type: "number",
        required: false,
        description: "scope=events：保留末 N 条 event 不折，其余折成一条摘要",
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
        description: "scope=events：该区段摘要文本（折叠后 transcript 用它替换原始 events）",
      },
    },
  },
  exec: (ctx, _self, before_win, args) => {
    const a = (args ?? {}) as EventsCompressArgs;
    if (a.scope === "events") return compressEvents(ctx, before_win, a);
    return {
      ...before_win,
      compressLevel: clampLevel((before_win?.compressLevel ?? 0) + 1),
    };
  },
};

/** expand：scope=windows 调低档位一档（封底 0）；scope=events 展开折叠（at=展开一段 / 不给=全展开）。 */
const expand: WindowMethod<unknown, CompressWin> = {
  name: "expand",
  description:
    "展开折叠。scope=windows（默认）：本窗展开一档（2 仅句柄→1 缩略→0 全文）。" +
    "scope=events：展开本 thread 历史折叠——at=index 展开覆盖该 event index 的那段，不给 at 则清空全部折叠。",
  schema: {
    args: {
      scope: {
        type: "string",
        required: false,
        enum: ["windows", "events"],
        default: "windows",
        description: "windows=展本窗档位；events=展本 thread 历史折叠",
      },
      at: {
        type: "number",
        required: false,
        description: "scope=events：展开覆盖该 event index 的那一段；不给则清空全部折叠",
      },
    },
  },
  exec: (_ctx, _self, before_win, args) => {
    const a = (args ?? {}) as EventsCompressArgs;
    if (a.scope === "events") {
      return {
        ...before_win,
        summarizedRanges: removeSummarizedRange(before_win?.summarizedRanges, a.at),
      };
    }
    return {
      ...before_win,
      compressLevel: clampLevel((before_win?.compressLevel ?? 0) - 1),
    };
  },
};

/** 所有 window 默认可用的 window method（class 同名声明优先覆盖）。 */
export const DEFAULT_WINDOW_METHODS: WindowMethod[] = [compress, expand];

const DEFAULT_BY_NAME = new Map(DEFAULT_WINDOW_METHODS.map((m) => [m.name, m]));

/** 解析默认 window method —— class 自有声明未命中时的回退。 */
export function resolveDefaultWindowMethod(name: string): WindowMethod | undefined {
  return DEFAULT_BY_NAME.get(name);
}
