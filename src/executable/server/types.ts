import type { ThreadContext } from "../../thinkable/context";
import type { StoneObjectRef } from "../../persistable";

/** program 中注入的 self 对象，让用户代码能调用本对象的 method 与读写 data。 */
export interface ProgramSelf {
  /** stone 目录绝对路径。 */
  dir: string;
  /** 调用 server/index.ts 中 llm_methods 注册的方法。 */
  callMethod: (name: string, args?: Record<string, unknown>) => Promise<unknown>;
  /** 读 data.json 中的字段；不存在返回 undefined。 */
  getData: (key: string) => Promise<unknown>;
  /** 顶层 merge 写 data.json 中的字段。 */
  setData: (key: string, value: unknown) => Promise<void>;
  /**
   * 读取当前 thread 的局部数据（program_window 跨 exec 共享通道）。
   * spec § program_window：仅 ts/js exec 之间通过 thread.threadLocalData 传值；
   * shell 模式没有访问入口，需要落到 stone data 才能跨 exec。
   */
  getThreadLocal: (key: string) => unknown;
  /** 写当前 thread 的局部数据。 */
  setThreadLocal: (key: string, value: unknown) => void;
}

/** server method 调用时的上下文。 */
export interface ServerMethodContext {
  /** 同 self；server method 内部可继续调其它 method。 */
  self: ProgramSelf;
  /** 当前调用方线程，方便方法主动注入提示。 */
  thread: {
    id: string;
    inject: (text: string) => void;
  };
}

/** 单个注册到 server 的 LLM 可调用方法。 */
export interface ServerMethod {
  /** 给 LLM 看的方法说明（可选；不写时由默认 knowledge 生成器使用）。 */
  description?: string;
  /** 参数定义（可选；不写时由默认 knowledge 生成器使用；当前不强制校验）。 */
  params?: Array<{
    name: string;
    type?: string;
    description?: string;
    required?: boolean;
  }>;
  /**
   * 动态知识函数（可选）。
   *
   * 与 command.match(args) → paths 同理：当 form 处于 program.function 模式时，
   * 系统在 open/refine 后调用 knowledge(currentArgs)，并把结果并入
   * `internal/executable/program/function` 对应的 knowledge entry。
   *
   * 缺省时由默认实现从 description + params 拼出基线文本，保证 LLM 至少有静态提示。
   */
  knowledge?: (args: Record<string, unknown>) => string;
  /** 真正的执行函数。返回值会被 program 路径作为 returnValue 暴露给 LLM。 */
  fn: (ctx: ServerMethodContext, args: Record<string, unknown>) => unknown | Promise<unknown>;
}

/** server/index.ts 暴露的 llm_methods 字典。 */
export type LlmMethods = Record<string, ServerMethod>;

/** server/index.ts 暴露的 ui_methods 字典。 */
export type UiMethods = Record<string, ServerMethod>;

/** 内部用：缓存 stoneRef 与对应已加载的 methods（按 mtime 失效）。 */
export interface ServerLoaderEntry {
  mtime: number;
  llmMethods: LlmMethods;
  uiMethods: UiMethods;
}

export type { StoneObjectRef, ThreadContext };
