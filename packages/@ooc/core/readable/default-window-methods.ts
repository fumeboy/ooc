/**
 * 默认 window method —— 挂在**所有 window 公共层**的缺省方法表。
 *
 * 背景：window method 此前只能由各 class 在 `readable.window[].window_methods` 自行声明
 * （`resolveWindowMethod` 仅查 class 自有声明）。compress/expand 这类**对任何 window 都通用**的
 * 折叠/展开能力若依赖各 class 各自实现，必然「各自实现 ⇒ 无人实现」。故提供一张默认表：
 * `resolveWindowMethod` 在 class 自有声明未命中时回退此表（class 同名仍优先，可 override）。
 *
 * 契约同 {@link WindowMethod}：纯函数 `(ctx, self, before_win, args) => 新 win`，只动投影态、零副作用。
 * compress/expand 仅调单窗的展示**程度**（`compressLevel` 0|1|2），不碰 object data、不写 thread events。
 * —— `scope=events`（折叠 thread 对话历史）涉及改 `thread.events`，超出 window method 边界，
 *    归 thread object 自身能力，不在此默认表内。
 *
 * 读出侧：renderer（`thinkable/context/renderers/xml.ts`）按 `win.compressLevel` 投影详略
 * —— 0 全文 / 1 缩略 / 2 仅标题句柄。observable 侧（`observable/window-hash.ts`）已消费该字段。
 */
import type { WindowMethod } from "./contract.js";

/** compressLevel 投影档位上限：0 全文 / 1 缩略 / 2 仅句柄。 */
export const MAX_COMPRESS_LEVEL = 2;

interface CompressWin {
  compressLevel?: 0 | 1 | 2;
}

function clampLevel(n: number): 0 | 1 | 2 {
  return Math.max(0, Math.min(MAX_COMPRESS_LEVEL, n)) as 0 | 1 | 2;
}

/** compress：调高目标窗 `compressLevel` 一档（0→1→2，封顶）。纯投影态变更。 */
const compress: WindowMethod<unknown, CompressWin> = {
  name: "compress",
  description: "折叠本窗一档展示（0 全文 → 1 缩略 → 2 仅标题句柄）；exec(method=expand) 反向展开。",
  exec: (_ctx, _self, before_win) => ({
    ...before_win,
    compressLevel: clampLevel((before_win?.compressLevel ?? 0) + 1),
  }),
};

/** expand：调低目标窗 `compressLevel` 一档（2→1→0，封底）。纯投影态变更。 */
const expand: WindowMethod<unknown, CompressWin> = {
  name: "expand",
  description: "展开本窗一档展示（2 仅句柄 → 1 缩略 → 0 全文）；exec(method=compress) 反向折叠。",
  exec: (_ctx, _self, before_win) => ({
    ...before_win,
    compressLevel: clampLevel((before_win?.compressLevel ?? 0) - 1),
  }),
};

/** 所有 window 默认可用的 window method（class 同名声明优先覆盖）。 */
export const DEFAULT_WINDOW_METHODS: WindowMethod[] = [compress, expand];

const DEFAULT_BY_NAME = new Map(DEFAULT_WINDOW_METHODS.map((m) => [m.name, m]));

/** 解析默认 window method —— class 自有声明未命中时的回退。 */
export function resolveDefaultWindowMethod(name: string): WindowMethod | undefined {
  return DEFAULT_BY_NAME.get(name);
}
