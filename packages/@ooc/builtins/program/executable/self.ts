import { stoneDir, type StoneObjectRef } from "@ooc/core/persistable/index.js";
import { mergeFlowData, readFlowData } from "@ooc/core/persistable/index.js";
import type { ThreadContext } from "@ooc/core/thinkable/context.js";
import type { ObjectRegistry } from "@ooc/core/executable/windows/_shared/registry.js";
import { builtinRegistry } from "@ooc/core/executable/windows/index.js";
import type { MethodExecutionContext } from "@ooc/core/executable/windows/_shared/method-types.js";

/** program 中注入的 self 对象，让用户代码能调用任意 window 上任意 method 与读写 data。 */
export interface ProgramSelf {
  /** stone 目录绝对路径。 */
  dir: string;
  /**
   * 调用任意 window 上的任意已注册 method。
   *
   * - windowId：thread.contextWindows 中已存在的 window id（含 custom window）
   * - method：该 window 的 methods 表中的方法名
   * - args：method exec ctx.args 的内容
   *
   * 行为：在当前 thread 的 contextWindows 里 lookup window → 通过 ObjectRegistry 取
   * methods[method] → 走 entry.exec（type=custom 时由 dispatcher 注入 self）。
   *
   * 找不到 windowId / method 时抛清晰错误（包含当前可见 window/method 列表）。
   */
  callMethod: (windowId: string, command: string, args?: Record<string, unknown>) => Promise<unknown>;
  /** 读 data.json 中的字段；不存在返回 undefined。 */
  getData: (key: string) => Promise<unknown>;
  /** 顶层 merge 写 data.json 中的字段。 */
  setData: (key: string, value: unknown) => Promise<void>;
  /**
   * 读取当前 thread 的局部数据（program_window 跨 exec 共享通道）。
   */
  getThreadLocal: (key: string) => unknown;
  /** 写当前 thread 的局部数据。 */
  setThreadLocal: (key: string, value: unknown) => void;
}

/**
 * 构造 program 模式注入的 self 对象（plan §6.5 / §5.5）。
 *
 * - dir：stone 目录绝对路径
 * - callMethod(windowId, method, args?)：在当前 thread.contextWindows 里 lookup
 *   window → 通过 ObjectRegistry 取 methods[method] → exec(ctx)；type=custom
 *   时 dispatcher 会把 ProgramSelf 注入到 ctx.programSelf（2026-06-02 P6.§1 从 ctx.self 改名）
 * - getData/setData：读写 flow object 的 `data.json`
 *   （`flows/<sid>/objects/<self>/data.json`；2026-05-23 起从 stone 迁到 flow，
 *   详见 meta/object.doc.ts persistable.flow.session_data）。
 *   语义变化：不再是跨 session 长期数据；要跨 session 共享请走 stone server method
 *   写 pool/sql。无 thread.persistence 时 getData 返回 undefined / setData no-op。
 * - getThreadLocal/setThreadLocal：thread 级临时数据，跨 ts/js exec 共享
 */
export function createProgramSelf(
  stoneRef: StoneObjectRef,
  thread: ThreadContext,
  registry: ObjectRegistry = builtinRegistry,
): ProgramSelf {
  const dir = stoneDir(stoneRef);
  const self: ProgramSelf = {
    dir,
    async callMethod(windowId, method, args = {}) {
      const window = thread.contextWindows.find((w) => w.id === windowId);
      if (!window) {
        const visible = thread.contextWindows.map((w) => `${w.id}(${w.class})`).join(", ") || "(无)";
        throw new Error(
          `windowId ${windowId} 不在当前 thread.contextWindows；当前可见：${visible}`,
        );
      }

      // 取该 window type 的 methods
      const def = registry.getObjectDefinition(window.class);
      const methods = def.methods;

      const entry = methods[method];
      if (!entry) {
        const available = Object.keys(methods).join(", ") || "(无)";
        throw new Error(
          `windowId ${windowId} (${window.class}) 上不存在 method ${method}；当前可用：${available}`,
        );
      }

      const ctx: MethodExecutionContext & { programSelf: ProgramSelf } = {
        thread,
        self: window,
        args,
        programSelf: self,
      };
      return entry.exec(ctx);
    },
    async getData(key) {
      // 无 thread.persistence 时 → 没有可读的 flow data.json，返回 undefined
      const persistence = thread.persistence;
      if (!persistence) return undefined;
      const data = await readFlowData(persistence);
      return data[key];
    },
    async setData(key, value) {
      // 无 thread.persistence 时 → setData 静默 no-op（与 getData 对称；测试场景下不期望写盘）
      const persistence = thread.persistence;
      if (!persistence) return;
      await mergeFlowData(persistence, { [key]: value });
    },
    /**
     * thread-local 数据：program_window 跨 exec 时由 ts/js sandbox 通过这里传值。
     */
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
