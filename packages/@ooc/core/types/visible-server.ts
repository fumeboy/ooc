import type { MethodCallSchema } from "./intent.js";

/** visible/server method 的执行上下文 */
export interface VisibleServerContext {
  /** world 根目录。 */
  baseDir: string;
  session: { baseDir: string; sessionId: string };
  /** 接收者对象的身份元信息（id / class）。业务数据经 self 入参，**不**在此。 */
  object: { id: string; class: string };
  /** 改 object data 后报告 → dispatch 触发 persistable.save */
  reportDataEdit?: () => Promise<void>;
  args: Record<string, unknown>;
}

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
