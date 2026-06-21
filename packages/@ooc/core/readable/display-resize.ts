/**
 * compress v2 协议 —— 内容窗的 `resize`（共享实现，class **自声明**才生效；无通用默认表）。
 *
 * 设窗的展示**档位** `compressLevel`（0 全文 / 1 缩略 / 2 仅句柄）——读出侧 `xml.ts:projectByCompressLevel`
 * 按档位投影详略。content / 工具窗（file/terminal/search/…）若要支持「折叠展示」，在自己 readable 的
 * `window[].window_methods` 里声明本方法（`displayResize`）即可。**不存在默认 resize**——不声明 = 不可 resize。
 *
 * 与 thread 窗的 `resize` 区别：thread 窗 resize 设 `autoCompressLevel`（自动压缩阈值，过程增长型），
 * 本方法设 `compressLevel`（静态内容窗的展示详略）。二者同名、各 class 自实现自己的语义（compress 是协议）。
 */
import type { WindowMethod } from "./contract.js";

const clampLevel = (n: number): 0 | 1 | 2 => Math.max(0, Math.min(2, n)) as 0 | 1 | 2;

/**
 * 内容窗 resize：设展示档位 compressLevel（0 全文 / 1 缩略 / 2 句柄）。
 * Win 用 `any`——本方法通用于任意内容窗（各自有不同 Win 形态如 FileWin/SearchWin），只 spread 保留
 * before_win 全字段 + 覆 compressLevel；声明进各 class 自己的 window_methods（WindowMethod<Data,XxxWin>[]）才生效。
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const displayResize: WindowMethod<unknown, any> = {
  name: "resize",
  description: "调本窗展示档位 level：0=全文，1=缩略，2=仅句柄（折叠成标题）。",
  schema: {
    args: {
      level: {
        type: "number",
        required: true,
        enum: [0, 1, 2],
        description: "展示档位：0 全文 / 1 缩略 / 2 仅句柄",
      },
    },
  },
  exec: (_ctx, _self, before_win, args) => {
    const raw = (args as { level?: number } | undefined)?.level;
    return { ...before_win, compressLevel: clampLevel(typeof raw === "number" ? raw : 0) };
  },
};
