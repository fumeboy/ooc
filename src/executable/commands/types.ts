import type { ThreadContext } from "../../thinkable/context";
import type { ActiveForm } from "../forms/form";

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
  /** 执行底层 command 的回调（可选；暂未实现）。 */
  exec?: (args: Record<string, unknown>) => Promise<void> | void;
}

/** 命令执行上下文（占位类型，暂不包含具体字段） */
export interface CommandExecutionContext {
  thread?: ThreadContext;
  form?: ActiveForm;
  args: Record<string, unknown>;
}
