/**
 * agent —— OOC Agent 基类的后端程序路由。
 *
 * 一处 `export const Class` 装配 agency（executable）+ self 门面窗投影（readable）+ 身份持久化（persistable）。
 * - construct：造 agent 实例的初始 data（`self` = 身份正文文本，缺省空）。
 * - executable：agency（talk/plan/todo/end）。
 * - readable：把 `data.self` 投影为 self 门面窗内容（身份正文）。
 * - persistable：把 `data.self` 写入/读回实例目录的 self.md（self.md 只属 agent 实例，
 *   见对象模型核心 9）；渲染器在投影前经 registry 派发 load hydrate self 门面窗 data。
 * 继承它的具体 agent（supervisor 等）经 ooc.class 继承本类。
 */

import type { OocClass } from "@ooc/core/runtime/ooc-class.js";
import type { ObjectConstructor } from "@ooc/core/executable/contract.js";
import executable from "./executable/index.js";
import readable from "./readable/index.js";
import persistable from "./persistable/index.js";
import type { Data } from "./types.js";

const construct: ObjectConstructor<Data> = {
  description: "Create an agent instance with an identity (self.md text).",
  schema: {
    args: {
      self: {
        type: "string",
        required: false,
        description: "agent 身份正文（self.md 内容）；缺省为空，可后续编辑。",
      },
    },
  },
  exec: (_ctx, args) => ({
    self: typeof args?.self === "string" ? args.self : "",
  }),
};

export const Class: OocClass<Data> = {
  construct,
  executable,
  readable,
  persistable,
};

export type { Data } from "./types.js";
