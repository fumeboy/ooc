import { stoneDir, type StoneObjectRef } from "@ooc/core/persistable/index.js";
import type { RuntimeHandle } from "@ooc/core/executable/contract.js";

/** interpreter 中注入的 self 对象，让 ts/js 用户代码能调用任意 window 上任意 method 与读写 data。 */
export interface InterpreterSelf {
  /** stone 目录绝对路径。 */
  dir: string;
  /**
   * 调用任意 window 上的任意已注册 method。
   *
   * - windowId：当前 thread 内已存在的 window id（含 custom window）
   * - command：该 window 的 method 名
   * - args：method 调用参数
   *
   * 找不到 windowId / method 时抛清晰错误。
   */
  callMethod: (windowId: string, command: string, args?: Record<string, unknown>) => Promise<unknown>;
  /** 读本 interpreter_process 实例自身 data（userData 子字段）中的字段；不存在返回 undefined。 */
  getData: (key: string) => Promise<unknown>;
  /** 顶层 merge 写本 interpreter_process 实例自身 data（userData 子字段）中的字段，随默认 data.json 落盘。 */
  setData: (key: string, value: unknown) => Promise<void>;
}

/**
 * 构造 interpreter 注入的 self 对象。
 *
 * - dir：stone 目录绝对路径
 * - getData/setData：读写**本 interpreter_process 实例自身的 data**（`data.userData` 子字段，
 *   隔离 history 投影）。setData 写入活的 userData 引用后调 reportDataEdit，随默认 data.json
 *   落盘、并在下次 exec 时 hydrate 回来。
 *
 * `callMethod`：经 `runtime.callMethod`（RuntimeHandle）委托调当前 thread 内某 object 的
 * object method（runtime 解析目标 class → resolveObjectMethod → 三参 exec）。runtime 缺席
 * （无 persistence / 未接通）或目标无该 method 时抛清晰错误。getData/setData 不依赖 dispatch。
 *
 * @param userData         本 process 实例自身 data 的 `userData` 子字段（活引用，setData 直接改写它）
 * @param reportDataEdit   通知 runtime data 已改、需重新持久化（construct 阶段可缺省——
 *                         setData 改写的 userData 随 construct 返回的 Data 落盘）
 */
export function createInterpreterSelf(
  stoneRef: StoneObjectRef,
  userData: Record<string, unknown>,
  runtime?: RuntimeHandle,
  reportDataEdit?: () => Promise<void>,
): InterpreterSelf {
  const dir = stoneDir(stoneRef);
  const self: InterpreterSelf = {
    dir,
    async callMethod(windowId, command, args) {
      if (!runtime?.callMethod) {
        throw new Error(
          `[interpreter_process] self.callMethod(${windowId}, ${command}) 不可用：` +
            `当前 exec 无 runtime.callMethod 通道。`,
        );
      }
      return runtime.callMethod(windowId, command, args ?? {});
    },
    async getData(key) {
      return userData[key];
    },
    async setData(key, value) {
      userData[key] = value;
      await reportDataEdit?.();
    },
  };
  return self;
}
