/**
 * self-proxy 工厂 —— 把 session 对象表里的活 Data 包成 method 的 `self` 入参。
 *
 * 类型（SelfProxy / ReadonlySelfProxy / SelfMethods）在零依赖层 `_shared/types/self-proxy.ts`；
 * 本模块持需要 RuntimeHandle 的工厂实现：
 *
 * - `makeSelfProxy`（读写 + 自调方法）：给 executable object method。`self.data` 读写落在活引用上
 *   （经 method 末 reportDataEdit 刷盘）；`self.methods.foo(args)` → runtime.callMethod(selfId,"foo",args)
 *   （exec-by-name 自指；无 runtime 通道抛错）。
 * - `makeReadonlySelfProxy`（只读）：给 window method / readable。`self.data` set-trap 拒写
 *   （读侧不得改业务数据，与「window method 只动 win、readable 只投影」契约一致）；无 methods。
 *
 * 设计权威：`.ooc-world-meta/.../children/object/self.md`（对象模型核心 5/6）。
 */

import type { RuntimeHandle } from "../executable/contract.js";
import type {
  SelfProxy,
  ReadonlySelfProxy,
  SelfMethods,
} from "../_shared/types/self-proxy.js";

export type { SelfProxy, ReadonlySelfProxy, SelfMethods };

/**
 * 建读写 self-proxy（给 object method）。
 *
 * @param data     session 对象表里该对象的**活 data 引用**（self.data 的读写直接作用其上）。
 * @param selfId   本对象 id（self.methods.x 自调时作为派发目标）。
 * @param runtime  runtime 句柄（self.methods.x → runtime.callMethod）；缺席则 self.methods.x 抛错。
 */
export function makeSelfProxy<Data extends object = any>(
  data: Data,
  selfId: string,
  runtime: RuntimeHandle | undefined,
): SelfProxy<Data> {
  const methods = new Proxy({} as SelfMethods, {
    get(_t, name: string) {
      return (args: Record<string, unknown> = {}) => {
        if (!runtime?.callMethod) {
          return Promise.reject(
            new Error(
              `[self.methods.${name}] 不可用：当前 method 执行无 runtime.callMethod 通道（自调对象方法需 runtime）。`,
            ),
          );
        }
        return runtime.callMethod(selfId, name, args);
      };
    },
  });
  return { data, methods };
}

/**
 * 建只读 self-proxy（给 window method / readable）。
 * data 经 set-trap 拒写——读侧不得改业务数据（window method 只动 win、readable 只投影）。
 */
export function makeReadonlySelfProxy<Data extends object = any>(
  data: Data,
): ReadonlySelfProxy<Data> {
  const ro = new Proxy(data, {
    set(_t, prop: string) {
      throw new Error(
        `[self.data.${prop}] 只读：window method / readable 不得改 object data（只动投影态 win / 只投影）。`,
      );
    },
    deleteProperty(_t, prop: string) {
      throw new Error(`[self.data.${prop}] 只读：不得删除 object data 字段。`);
    },
  });
  return { data: ro as Readonly<Data> };
}
