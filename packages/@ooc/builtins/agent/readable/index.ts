/**
 * agent —— readable 维度（self 门面窗投影）。
 *
 * agent 实例经 init 注入一个 **self 门面窗**（`win.isSelfWindow`，inst.class=`_builtin/agent`），
 * 承载该 agent 的**身份正文** `data.self`（= self.md 内容）。本模块把 `data.self` 投影为
 * 窗内容：身份正文存在则渲为 readable 文本，缺省/空身份 → 空内容（不输出占位文案）。
 *
 * 投影 class 固定 `"default"`（issue 2026-06-26 default window class convention）——单视角
 * class 强约束。旧实现返 `ctx.object.class`（= 实例 objectId）属设计漂移，window decl
 * `class:"_builtin/agent"` 永远 miss，已修。
 *
 * agency（talk/plan）不在此 window decl 内逐条声明：self 门面窗经渲染器 isSelf 门控
 * surface 对象**全部自有 object method**（经 `resolveObjectMethods` 本类直查得到的扁平 method 集；
 * 子若要复用父 method 由子 class 源码经 spread 在装配期完成，registry 只见扁平结果）。此处 window
 * decl 仅声明投影 class 形状；object_methods 列出 agency 仅为自文档，实际 surface 由 isSelf 路径兜全。
 * end/todo 已迁 thread 作用域，不属 agent。
 *
 * self.md 的读盘（hydrate `data.self`）由 agent persistable.load 负责，渲染器在投影前
 * 经 registry 派发——renderer 不再直接 readSelf（对象模型核心 9：self.md 只属 agent 实例）。
 */
import type {
  ReadableContext,
  ReadableModule,
} from "@ooc/core/types";
import type { ReadonlySelfProxy } from "@ooc/core/types";
import type { OocObjectRef } from "@ooc/core/runtime/ooc-class.js";
import type { Data } from "../types.js";

/** self 门面窗的投影态（init 注入 `{ transient, isSelfWindow }`）。 */
export interface AgentWin {
  isSelfWindow?: boolean;
}

const readable: ReadableModule<Data, AgentWin> = {
  readable: (
    _ctx: ReadableContext,
    self: ReadonlySelfProxy<Data>,
    _win: OocObjectRef<AgentWin>,
  ) => {
    const body = self.data?.self ?? "";
    return {
      view: "default",
      content: body.trim().length > 0 ? body : [],
    };
  },
  window: [
    {
      view: "default",
      // 仅列实际注册的 method（issue 2026-06-26-object-guide-method-split 引入 cohesion 校验，
      // 悬空引用 fail-loud）；self 门面窗的真实 surface 由 isSelf 渲染器走 resolveObjectMethods 兜全。
      object_methods: ["talk"],
      window_methods: [],
    },
  ],
  /**
   * **issue N**: agent self 门面窗产 `class::root` —— "你是谁、你在哪"层级的 knowledge
   * （interaction-core.md / agency-methods.md / self-evolution.md / talk-and-super.md / end-reflection.md）
   * 据此命中。每个 thread.contextWindows 总含 callee agent ref（self 门面）,所以 `class::root` 在
   * 任何 thread 任何时候都命中。
   */
  intents: () => ["class::root"],
};

export default readable;
