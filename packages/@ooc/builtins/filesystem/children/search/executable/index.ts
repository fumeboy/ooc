/**
 * search —— executable 维度（object method）。
 *
 * object method 签名 `(ctx, self, args)`，**可改 self（Data）、可副作用**。
 * 与 readable 维度（投影 + window method，在 ../readable/index.ts）物理分离。
 *
 * - close      : 关闭本 search 窗（不影响命中的文件）
 * - open_match : 对某个 match 的路径 spawn 一个 file 对象（经 ctx.runtime.instantiate('file', …)）
 *
 * 构造（glob/grep 执行 + 截断）在 ../index.ts 的 `Class.construct`。
 */

import { isAbsolute, resolve } from "node:path";
import type {
  ExecutableContext,
  ObjectMethod,
  ExecutableModule,
} from "@ooc/core/executable/contract.js";
import type { Data } from "../types.js";

/** open_match 在 file 对象上套的上下文行数（match.line ± 该值）。 */
const FILE_WINDOW_LINE_CONTEXT = 40;

// file 对象的注册 class id（与 filesystem.open_file 的 FILE_CLASS 一致）；
// 裸名 "file" 在 registry 解析不到 constructor（注册键为 _builtin/filesystem/file）。
const FILE_CLASS = "_builtin/filesystem/file";

const closeMethod: ObjectMethod<Data> = {
  name: "close",
  description: "Close this search window (does not affect matched files).",
  exec: (ctx: ExecutableContext) => {
    void ctx.runtime?.close?.(ctx.object.id);
    return undefined;
  },
};

const openMatchMethod: ObjectMethod<Data> = {
  name: "open_match",
  description:
    "Open a file object for the match at the given index in this search window.",
  schema: {
    args: {
      index: {
        type: "number",
        required: true,
        description: "match index from search matches[].index",
      },
    },
  },
  exec: async (
    ctx: ExecutableContext,
    self: Data,
    args: { index?: number },
  ): Promise<string | undefined> => {
    const indexArg = args.index;
    if (typeof indexArg !== "number") {
      return "[search.open_match] 缺少 index 参数（应是整数）。";
    }
    const match = self.matches.find((m) => m.index === indexArg);
    if (!match) {
      return `[search.open_match] match index ${indexArg} 不存在（当前 ${self.matches.length} 条 match，最大 index ${self.matches.length - 1}）。`;
    }

    const runtime = ctx.runtime;
    if (!runtime) return "[search.open_match] 缺少 runtime context。";

    const lines: [number, number] | undefined =
      typeof match.line === "number"
        ? [
            Math.max(0, match.line - FILE_WINDOW_LINE_CONTEXT),
            match.line + FILE_WINDOW_LINE_CONTEXT,
          ]
        : undefined;

    const absPath = isAbsolute(match.path)
      ? match.path
      : resolve(self.searchRoot ?? process.cwd(), match.path);

    await runtime.instantiate(FILE_CLASS, { path: absPath, lines });
    return undefined;
  },
};

const executable: ExecutableModule<Data> = {
  methods: [closeMethod, openMatchMethod],
};

export default executable;
