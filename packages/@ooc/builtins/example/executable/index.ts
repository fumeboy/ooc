/**
 * example —— executable 维度（标准对象定义样板的一半）。
 *
 * 本文件**只**注册 executable 维度：object method（控制业务数据）+ constructor。
 * readable 维度（readable / window method / compressView）在隔壁 `../readable.ts`，
 * 两个维度由 barrel `../index.ts` 分别加载、经 registry 的 `registerExecutable` /
 * `registerReadable` 两个入口分别注册——这正是本 example 要示范的（executable 不 import readable）。
 *
 * - constructor `example`：构造 example_window（message 业务数据 + 默认 viewport）。
 * - object method `bump`：累加 bumpCount（业务数据，Object.assign mutate ctx.self）。
 * - object method `close`：释放窗口（manager 收尾）。
 */

import type {
  MethodExecutionContext,
  ObjectMethod,
} from "@ooc/core/extendable/_shared/method-types.js";
import { builtinRegistry } from "@ooc/core/extendable/_shared/registry.js";
import { DEFAULT_VIEWPORT } from "@ooc/core/extendable/_shared/viewport.js";
import {
  ROOT_WINDOW_ID,
  generateWindowId,
} from "@ooc/core/extendable/_shared/types.js";
import { emptyIntent, isString } from "@ooc/builtins/_shared/executable/utils.js";
import type { ExampleWindow } from "../types.js";

// readable 维度由 barrel index.ts 的 import "./readable.js" 加载（executable 不 import readable）。

const bumpMethod: ObjectMethod = {
  paths: ["bump"],
  intent: emptyIntent,
  exec: (ctx: MethodExecutionContext) => {
    // 业务数据修改：mutate ctx.self（与 plan/markDone 等内置 object method 同惯例）。
    const self = ctx.self as ExampleWindow | undefined;
    if (!self) return "[example.bump] 缺少 self。";
    self.bumpCount = (self.bumpCount ?? 0) + 1;
    return `bumped → ${self.bumpCount}`;
  },
};

const closeMethod: ObjectMethod = {
  paths: ["close"],
  intent: emptyIntent,
  exec: () => undefined, // manager 在 close 路径上收尾移除窗口
};

const exampleConstructor: ObjectMethod = {
  kind: "constructor",
  paths: ["example"],
  schema: {
    args: {
      message: { type: "string", description: "要展示的文本（可多行）" },
    },
  },
  intent: emptyIntent,
  permission: () => "allow",
  exec: (ctx: MethodExecutionContext) => {
    const message = isString(ctx.args.message) ? ctx.args.message : "(empty)";
    const window: ExampleWindow = {
      id: generateWindowId("example"),
      type: "example",
      parentWindowId: ROOT_WINDOW_ID,
      title: "example",
      status: "open",
      createdAt: Date.now(),
      message,
      bumpCount: 0,
      // 展示状态归 state.viewport（readable 维度的 set_viewport window method 读写）。
      state: { viewport: { ...DEFAULT_VIEWPORT } },
    };
    return { ok: true, object: window };
  },
};

builtinRegistry.registerExecutable("example", {
  methods: {
    bump: bumpMethod,
    close: closeMethod,
    example: exampleConstructor,
  },
});
