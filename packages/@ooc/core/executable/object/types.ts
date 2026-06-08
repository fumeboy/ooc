/**
 * server 层公共类型。
 *
 * D6 硬切后：旧的 `LlmMethods` / `ServerMethod` / `ServerMethodContext` 三件套被
 * 删除；LLM 路径上的"自定义方法"统一通过 `StoneObjectDeclaration.methods`
 * （见 `./object-types.ts`）以标准 `ObjectMethod` 形态注册到 type=`custom`
 * 的 ContextWindow 上。
 *
 * 仅保留：
 * - `ProgramSelf` —— program 模式 ts/js sandbox 注入的 self；`callMethod`
 *   按 windowId 查 thread.contextWindows 并执行该 window 上的 method
 * - UI 路径相关：`UiServerMethod` / `UiMethods` / `UiServerMethodContext` ——
 *   `ui_methods` 仍由 server/index.ts 平行导出（plan D3 完全保留）；HTTP
 *   `flows.callMethod` / `stones.callMethod` 路径只服务这一字典
 */

import type { ThreadContext } from "../../thinkable/context";
import type { StoneObjectRef } from "../../persistable";
import type { StoneObjectDeclaration } from "./object-types";
import type { ReadableFn } from "../windows/_shared/registry.js";

export type { StoneObjectDeclaration };

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

// ─────────────────────────── ui_methods 路径（保留） ───────────────────────────

/** ui_methods 调用时的上下文；只在 HTTP /call_method 入口被使用。 */
export interface UiServerMethodContext {
  /** 同 self；ui method 内部可再调本对象其它方法 */
  self: ProgramSelf;
  /** 当前调用方线程；HTTP 路径可能没有线程上下文 */
  thread: {
    id: string;
    inject: (text: string) => void;
    persistence?: {
      baseDir: string;
      sessionId: string;
      objectId: string;
      threadId: string;
    };
  };
}

/** 单个 ui_methods 方法。 */
export interface UiServerMethod {
  description?: string;
  params?: Array<{
    name: string;
    type?: string;
    description?: string;
    required?: boolean;
  }>;
  knowledge?: (args: Record<string, unknown>) => string;
  fn: (ctx: UiServerMethodContext, args: Record<string, unknown>) => unknown | Promise<unknown>;
}

/** server/index.ts 暴露的 ui_methods 字典。 */
export type UiMethods = Record<string, UiServerMethod>;

// ─────────────────────────── loader 内部缓存条目 ───────────────────────────

/** 缓存 stoneRef 与对应已加载的 server 配置（按 mtime 失效）。 */
export interface ServerLoaderEntry {
  mtime: number;
  /** Object 自定义 custom window；server/index.ts 没有 `export const window` 时为 undefined */
  window: StoneObjectDeclaration | undefined;
  /** ui_methods 字典；server/index.ts 没有则为空对象 */
  uiMethods: UiMethods;
  /** readable.ts 导出的动态渲染函数；不存在则为 undefined */
  readable: ReadableFn | undefined;
}

export type { StoneObjectRef, ThreadContext };
