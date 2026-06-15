/**
 * knowledge —— executable 维度（object method）。
 *
 * object method 签名 `(ctx, self, args)`，self=Data。knowledge 的两个 method（reload/close）是
 * 语义提示 no-op：knowledge loader 按 mtime 自动失效，close 由 runtime 在窗层处理。
 *
 * 与 readable 维度（投影 + window method set_viewport，在 ../readable/index.ts）物理分离。
 * constructor（open_knowledge）在 ../index.ts 装配。
 *
 * deferred hook（契约暂无、Wave3 反推 core 时 re-home）：
 *   - onClose：拒绝 close 非 explicit 来源的 knowledge（合成窗每轮再生，不可显式关闭）——
 *     见 ../index.ts 的 `rejectCloseNonExplicit` 注释保留逻辑。
 */

import type {
  ExecutableContext,
  ObjectMethod,
  ExecutableModule,
} from "@ooc/core/executable/contract.js";
import type { Data } from "../types.js";

const reloadMethod: ObjectMethod<Data> = {
  name: "reload",
  description:
    "Force knowledge re-activation next turn (loader auto-invalidates by mtime; this is a semantic hint).",
  exec: (_ctx: ExecutableContext, _self: Data) => undefined,
};

const closeMethod: ObjectMethod<Data> = {
  name: "close",
  description:
    "Close this explicit knowledge window (protocol/activator knowledge cannot be closed).",
  exec: (_ctx: ExecutableContext, _self: Data) => undefined,
};

const executable: ExecutableModule<Data> = {
  methods: [reloadMethod, closeMethod],
};

export default executable;
