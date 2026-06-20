/**
 * 默认 window method —— 挂在**所有 window 公共层**的缺省方法表。
 *
 * 背景：window method 此前只能由各 class 在 `readable.window[].window_methods` 自行声明
 * （`resolveWindowMethod` 仅查 class 自有声明）。compress/expand 对任何 window 通用的部分 = 调单窗的
 * 展示**档位**（scope=windows，`compressLevel` 0|1|2）——读出侧 `xml.ts:projectByCompressLevel`
 * 按档位投影（0 全文 / 1 缩略 / 2 仅句柄）。若依赖各 class 各自实现，必然「各自实现 ⇒ 无人实现」，
 * 故提供此默认表：`resolveWindowMethod` 在 class 自有声明未命中时回退（class 同名仍优先，可 override）。
 *
 * **scope=events（折叠 thread 历史 transcript）不在通用层**——它归属「内容所在的窗」即 thread 窗
 * （compress.md 核心 7），由 thread class 自声明 compress/expand（`thread/readable/compress-events.ts`）
 * 覆盖此默认表。通用层对 scope=events **抛错指向 thread 窗**，避免错窗（如 self 门面窗）静默落折叠态——
 * 折叠态落错窗、读出侧从 thread 窗读 → 写读不同窗 → 静默失效。响亮报错即 silent-swallow ban。
 *
 * 契约同 {@link WindowMethod}：纯函数 `(ctx, self, before_win, args) => 新 win`，只动投影态、零副作用。
 */
import type { WindowMethod } from "./contract.js";

/** compressLevel 投影档位上限：0 全文 / 1 缩略 / 2 仅句柄。 */
const MAX_COMPRESS_LEVEL = 2;

interface CompressLevelWin {
  compressLevel?: 0 | 1 | 2;
}

function clampLevel(n: number): 0 | 1 | 2 {
  return Math.max(0, Math.min(MAX_COMPRESS_LEVEL, n)) as 0 | 1 | 2;
}

/** scope=events 落到通用层（非 thread 窗）时的指引——events 折叠归 thread 窗。 */
const EVENTS_NOT_HERE =
  "[scope=events] 本窗无过程/会话 transcript 可折——events 折叠归你的 thread 窗（内容所在的窗）。" +
  '用 exec(window_id="<你的 thread 窗 id>", method="compress", args={scope:"events", keepTail:N, summary:"…"})。';

const SCOPE_ARG = {
  type: "string" as const,
  required: false,
  enum: ["windows", "events"],
  default: "windows",
  description: "windows=折/展本窗展示档位（本层）；events=折/展 thread 历史（属 thread 窗，本层不支持）",
};

/** compress：scope=windows（默认）调高档位一档（封顶 2）。scope=events 不属本层 → 抛错指向 thread 窗。 */
const compress: WindowMethod<unknown, CompressLevelWin> = {
  name: "compress",
  description:
    "折叠本窗展示档位（0 全文→1 缩略→2 仅句柄）。" +
    "折叠 thread 历史 transcript 请在你的 thread 窗上 compress(scope=events)。",
  schema: { args: { scope: SCOPE_ARG } },
  exec: (_ctx, _self, before_win, args) => {
    if ((args as { scope?: string } | undefined)?.scope === "events") throw new Error(EVENTS_NOT_HERE);
    return { ...before_win, compressLevel: clampLevel((before_win?.compressLevel ?? 0) + 1) };
  },
};

/** expand：scope=windows（默认）调低档位一档（封底 0）。scope=events 不属本层 → 抛错指向 thread 窗。 */
const expand: WindowMethod<unknown, CompressLevelWin> = {
  name: "expand",
  description:
    "展开本窗展示档位（2 仅句柄→1 缩略→0 全文）。" +
    "展开 thread 历史折叠请在你的 thread 窗上 expand(scope=events)。",
  schema: { args: { scope: SCOPE_ARG } },
  exec: (_ctx, _self, before_win, args) => {
    if ((args as { scope?: string } | undefined)?.scope === "events") throw new Error(EVENTS_NOT_HERE);
    return { ...before_win, compressLevel: clampLevel((before_win?.compressLevel ?? 0) - 1) };
  },
};

/** 所有 window 默认可用的 window method（class 同名声明优先覆盖）。 */
export const DEFAULT_WINDOW_METHODS: WindowMethod[] = [compress, expand];

const DEFAULT_BY_NAME = new Map(DEFAULT_WINDOW_METHODS.map((m) => [m.name, m]));

/** 解析默认 window method —— class 自有声明未命中时的回退。 */
export function resolveDefaultWindowMethod(name: string): WindowMethod | undefined {
  return DEFAULT_BY_NAME.get(name);
}
