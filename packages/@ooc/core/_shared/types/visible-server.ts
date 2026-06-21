/**
 * visible/server 维度契约 —— ooc class 的**人类侧服务端 API**（A2：control-plane 编辑模型）。
 *
 * 设计权威：`.ooc-world-meta/.../children/visible/self.md`（visible/server ctx 单一权威）。
 * 放 `_shared/types`（core 无 visible 后端目录；本层零依赖，被 ooc-class + app/server 双引无环）。
 *
 * 与 executable 的 object method 区别：
 *   - object method 跑在某 thread 的 thinkloop 内（LLM 行使），ctx 带 live thread / runtime 句柄。
 *   - visible/server method 跑在 **HTTP 控制面**（人类侧 UI 请求），**无 live thread / 无 thinkloop runtime**——
 *     只编辑 object data，改后经 reportDataEdit → dispatch 触发 persistable.save（非版本化、eager 落盘）。
 *
 * A2 v1 仅 flow scope（session 必有）；stone scope 延后。
 */

import type { MethodCallSchema } from "./intent.js";

/** visible/server method 的执行上下文 —— 人类侧服务端 API；**无 thinkloop thread**。 */
export interface VisibleServerContext {
  /** world 根目录。 */
  baseDir: string;
  /** 目标 flow（A2 v1 仅 flow scope，必有）。 */
  session: { baseDir: string; sessionId: string };
  /** 接收者对象的身份信封（id / class）。业务数据经 self 入参，**不**在此。 */
  object: { id: string; class: string };
  /** 改 object data 后报告 → dispatch 触发 persistable.save（eager 落盘）。 */
  reportDataEdit?: () => Promise<void>;
  /** 调用参数副本（与 exec 的 args 入参同源）。 */
  args: Record<string, unknown>;
}

/**
 * visible/server method 定义。
 *
 * - name        : 方法名（HTTP call_method dispatch 入口）
 * - description : 方法描述（人类/UI 面向，可选）
 * - schema      : 可选参数 schema
 * - exec        : (ctx, self, args) → 结果；**改入参 self（pass-by-ref）→ 经 reportDataEdit 落盘**
 *                 （与 thinkloop object method 一致：method 改 self 入参，不返回新 data 对象）
 */
export interface VisibleServerMethod<Data = any> {
  name: string;
  description?: string;
  schema?: MethodCallSchema;
  exec: (
    ctx: VisibleServerContext,
    self: Data,
    args: Record<string, unknown>,
  ) => unknown | Promise<unknown>;
}

/** visible/server 维度模块 —— class `index.ts` 的 `visibleServer` 装配。 */
export interface VisibleServerModule<Data = any> {
  methods: VisibleServerMethod<Data>[];
}
