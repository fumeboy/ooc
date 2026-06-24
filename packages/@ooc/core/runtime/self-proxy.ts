import type {
  RuntimeHandle,
  SelfProxy,
  ReadonlySelfProxy,
  SelfMethods,
} from "../types";

export type { SelfProxy, ReadonlySelfProxy, SelfMethods };

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
