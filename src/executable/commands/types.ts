import type { CodeExecutor } from "../sandbox/executor.js";
import type { MethodContext, MethodRegistry } from "../../extendable/trait/registry.js";
import type { TraitDefinition } from "../../types/index.js";
import type { ActiveForm } from "../../thread/form.js";
import type { ThreadScheduler } from "../../thread/scheduler.js";
import type { ThreadsTree } from "../../thread/tree.js";
import type { TalkFormPayload } from "../../thread/types.js";

/** 命令表条目（扁平结构，无嵌套子节点）。 */
export interface CommandTableEntry {
  /** 该 command 可能产出的所有 path 集合（用于反向索引建表 + 文档目录） */
  paths: string[];
  /**
   * 给定 args，返回此次激活的 path 子集（必含 command 自身名）。多条路径并行。
   *
   * 规则：
   * - 总是包含 bare command 名（如 "talk"）
   * - 各维度（wait、context、type 等）独立决定是否追加对应 path
   * - match 抛异常时退化为只返回 bare path
   */
  match: (args: Record<string, unknown>) => string[];
  /** 是否可通过 open(type=command, command=X) 打开。用于 OPEN_TOOL.command.enum 的动态生成。 */
  openable?: boolean;
  /** 执行底层 command 的回调（可选；当前 engine 在分支里直接处理）。 */
  exec?: (args: Record<string, unknown>) => Promise<void> | void;
}

export interface BuiltExecContext {
  context: Record<string, unknown>;
  getOutputs: () => string[];
  getWrittenPaths: () => string[];
}

export type OnTalk = (
  targetObject: string,
  message: string,
  fromObject: string,
  fromThreadId: string,
  sessionId: string,
  continueThreadId?: string,
  messageId?: string,
  forkUnderThreadId?: string,
  messageKind?: string,
) => Promise<{ reply: string | null; remoteThreadId: string }>;

export interface CommandExecutionContext {
  tree: ThreadsTree;
  threadId: string;
  objectName: string;
  sessionId: string;
  rootDir: string;
  traits: TraitDefinition[];
  form: ActiveForm;
  args: Record<string, unknown>;
  scheduler: ThreadScheduler;
  executor: CodeExecutor;
  methodRegistry: MethodRegistry;
  onTalk?: OnTalk;
  buildExecContext: (threadId: string) => BuiltExecContext;
  executeProgramTraitMethod: (params: {
    methodRegistry: MethodRegistry;
    trait?: string;
    method?: string;
    args: unknown;
    execCtx: MethodContext;
  }) => Promise<{ success: boolean; resultText: string }>;
  triggerBuildHooksAfterCall: (params: {
    trait?: string;
    methodName?: string;
    args: unknown;
    rootDir: string;
    threadId: string;
  }) => Promise<string>;
  runBuildHooks: (
    paths: string[],
    options: { rootDir: string; threadId?: string },
  ) => Promise<Array<{ hookName: string; path: string; success: boolean; output: string; errors?: string[] }>>;
  genMessageOutId: () => string;
  extractTalkForm: (raw: unknown) => TalkFormPayload | null;
  getAutoAckMessageId: (
    td: { inbox?: Array<{ id: string; from: string; timestamp: number; status: string }> } | null,
    talkTarget: string,
  ) => string | null;
}
