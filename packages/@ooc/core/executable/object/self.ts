import { stoneDir, type StoneObjectRef } from "../../persistable";
import { mergeFlowData, readFlowData } from "../../persistable";
import type { ThreadContext } from "../../thinkable/context";
import type { ProgramSelf } from "./types";
import type { ObjectRegistry } from "../windows/_shared/registry";
import { builtinRegistry } from "../windows/index.js";
import type { MethodExecutionContext } from "../windows/_shared/command-types";

/**
 * 构造 program 模式注入的 self 对象（plan §6.5 / §5.5）。
 *
 * - dir：stone 目录绝对路径
 * - callMethod(windowId, command, args?)：在当前 thread.contextWindows 里 lookup
 *   window → 通过 WindowRegistry 取 commands[command] → exec(ctx)；type=custom
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
    async callMethod(windowId, command, args = {}) {
      const window = thread.contextWindows.find((w) => w.id === windowId);
      if (!window) {
        const visible = thread.contextWindows.map((w) => `${w.id}(${w.type})`).join(", ") || "(无)";
        throw new Error(
          `windowId ${windowId} 不在当前 thread.contextWindows；当前可见：${visible}`,
        );
      }

      // 取该 window type 的 commands
      const def = registry.getObjectDefinition(window.type);
      let commands = def.methods;

      const entry = commands[command];
      if (!entry) {
        const available = Object.keys(commands).join(", ") || "(无)";
        throw new Error(
          `windowId ${windowId} (${window.type}) 上不存在 command ${command}；当前可用：${available}`,
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
