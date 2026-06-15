/**
 * builtin-visible-registry — builtin class 的 window 视觉组件静态注册表。
 *
 * 线 A（统一 window 渲染解析层）：thread_context 视图渲染 window 时，builtin window 走本
 * 注册表（编译时打包进 bundle，稳定/快），user-defined object 走运行时动态加载
 * （见 resolveWindowVisible.tsx）。消除了 ContextSnapshotViewer 里的 per-type switch
 * 与 HANDLED_WINDOW_TYPES 硬编码集合。
 *
 * 收拢的组件：
 * - 实存 builtin `visible/index.tsx`（file/knowledge/todo/search/skill_index/plan/terminal_process/interpreter_process/root）
 * - method_exec（本地 ./MethodExecWindowDetail）
 * - 从 viewer 内联抽出的 feishu_chat / feishu_doc / do / talk
 *
 * supervisor / user 不注册——它们返回 null、不接 window prop、不在 RENDERABLE_VISIBLE_TYPES，
 * 自然落 resolveWindowVisible 的 JSON 兜底（无害）。
 */
import type { ComponentType } from "react";
import type { ContextWindow } from "../../context-snapshot";

import FileWindowDetail from "@ooc/builtins/file/visible/index";
import KnowledgeWindowDetail from "@ooc/builtins/knowledge/visible/index";
import TodoWindowDetail from "@ooc/builtins/todo/visible/index";
import SearchWindowDetail from "@ooc/builtins/search/visible/index";
import SkillIndexWindowDetail from "@ooc/builtins/skill_index/visible/index";
import PlanWindowDetail from "@ooc/builtins/plan/visible/index";
import TerminalProcessWindowDetail from "@ooc/builtins/terminal_process/visible/index";
import InterpreterProcessWindowDetail from "@ooc/builtins/interpreter_process/visible/index";
import RootWindowDetail from "@ooc/builtins/root/visible/index";
import MethodExecWindowDetail from "../MethodExecWindowDetail";
import FeishuChatWindowDetail from "./FeishuChatWindowDetail";
import FeishuDocWindowDetail from "./FeishuDocWindowDetail";
import DoWindowDetail from "./DoWindowDetail";
import TalkWindowDetail from "./TalkWindowDetail";

/** builtin window type → 视觉组件。组件约定 `({ window }) => JSX`。 */
export const BUILTIN_VISIBLE: Record<string, ComponentType<{ window: ContextWindow }>> = {
  file: FileWindowDetail as ComponentType<{ window: ContextWindow }>,
  knowledge: KnowledgeWindowDetail as ComponentType<{ window: ContextWindow }>,
  todo: TodoWindowDetail as ComponentType<{ window: ContextWindow }>,
  search: SearchWindowDetail as ComponentType<{ window: ContextWindow }>,
  skill_index: SkillIndexWindowDetail as ComponentType<{ window: ContextWindow }>,
  plan: PlanWindowDetail as ComponentType<{ window: ContextWindow }>,
  terminal_process: TerminalProcessWindowDetail as ComponentType<{ window: ContextWindow }>,
  interpreter_process: InterpreterProcessWindowDetail as ComponentType<{ window: ContextWindow }>,
  root: RootWindowDetail as ComponentType<{ window: ContextWindow }>,
  method_exec: MethodExecWindowDetail as unknown as ComponentType<{ window: ContextWindow }>,
  feishu_chat: FeishuChatWindowDetail,
  feishu_doc: FeishuDocWindowDetail,
  do: DoWindowDetail,
  // 会话窗三 class 同形（H2）：talk other-view + thread/reflect_request self-view 共用 TalkWindowDetail。
  talk: TalkWindowDetail,
  thread: TalkWindowDetail,
  reflect_request: TalkWindowDetail,
};
