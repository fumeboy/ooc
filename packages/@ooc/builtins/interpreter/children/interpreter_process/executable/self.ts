import { stoneDir, type StoneObjectRef } from "@ooc/core/persistable/index.js";
import { mergeFlowData, readFlowData } from "@ooc/core/persistable/index.js";
import type { ThreadContext } from "@ooc/core/thinkable/context.js";
import type { RuntimeHandle } from "@ooc/core/executable/contract.js";

/** interpreter 中注入的 self 对象，让 ts/js 用户代码能调用任意 window 上任意 method 与读写 data。 */
export interface InterpreterSelf {
  /** stone 目录绝对路径。 */
  dir: string;
  /**
   * 调用任意 window 上的任意已注册 method。
   *
   * - windowId：thread.contextWindows 中已存在的 window id（含 custom window）
   * - command：该 window 的 method 名
   * - args：method 调用参数
   *
   * 找不到 windowId / method 时抛清晰错误。
   */
  callMethod: (windowId: string, command: string, args?: Record<string, unknown>) => Promise<unknown>;
  /** 读 data.json 中的字段；不存在返回 undefined。 */
  getData: (key: string) => Promise<unknown>;
  /** 顶层 merge 写 data.json 中的字段。 */
  setData: (key: string, value: unknown) => Promise<void>;
  /** 读取当前 thread 的局部数据（interpreter_process 跨 exec 共享通道）。 */
  getThreadLocal: (key: string) => unknown;
  /** 写当前 thread 的局部数据。 */
  setThreadLocal: (key: string, value: unknown) => void;
}

/**
 * 构造 interpreter 注入的 self 对象。
 *
 * - dir：stone 目录绝对路径
 * - getData/setData：读写 flow object 的 `data.json`
 *   （`flows/<sid>/objects/<self>/data.json`）。
 *   无 thread.persistence 时 getData 返回 undefined / setData no-op。
 * - getThreadLocal/setThreadLocal：thread 级临时数据，跨 ts/js exec 共享
 *
 * `callMethod`：经 `runtime.callMethod`（RuntimeHandle）委托调当前 thread 内某 object 的
 * object method（runtime 解析目标 class → resolveObjectMethod → 三参 exec）。runtime 缺席
 * （无 persistence / 未接通）或目标无该 method 时抛清晰错误。getData/setData/getThreadLocal/
 * setThreadLocal 不依赖 dispatch，原样保留。
 */
export function createInterpreterSelf(
  stoneRef: StoneObjectRef,
  thread: ThreadContext,
  runtime?: RuntimeHandle,
): InterpreterSelf {
  const dir = stoneDir(stoneRef);
  const self: InterpreterSelf = {
    dir,
    async callMethod(windowId, command, args) {
      if (!runtime?.callMethod) {
        const visible = thread.contextWindows.map((w) => `${w.id}(${w.class})`).join(", ") || "(无)";
        throw new Error(
          `[interpreter_process] self.callMethod(${windowId}, ${command}) 不可用：` +
            `当前 exec 无 runtime.callMethod 通道。当前可见 window：${visible}`,
        );
      }
      return runtime.callMethod(windowId, command, args ?? {});
    },
    async getData(key) {
      const persistence = thread.persistence;
      if (!persistence) return undefined;
      const data = await readFlowData(persistence);
      return data[key];
    },
    async setData(key, value) {
      const persistence = thread.persistence;
      if (!persistence) return;
      await mergeFlowData(persistence, { [key]: value });
    },
    getThreadLocal(key) {
      return thread.threadLocalData?.[key];
    },
    setThreadLocal(key, value) {
      if (!thread.threadLocalData) thread.threadLocalData = {};
      thread.threadLocalData[key] = value;
    },
  };
  return self;
}
