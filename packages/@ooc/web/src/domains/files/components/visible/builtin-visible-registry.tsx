/**
 * builtin-visible-registry — builtin class 的 window 视觉组件静态注册表。
 *
 * 线 A（统一 window 渲染解析层）：thread_context 视图渲染 window 时，builtin window 走本
 * 注册表（编译时打包进 bundle，稳定/快），user-defined object 走运行时动态加载
 * （见 resolveWindowVisible.tsx）。消除了 ContextSnapshotViewer 里的 per-type switch
 * 与 HANDLED_WINDOW_TYPES 硬编码集合。
 *
 * 收拢的组件：
 * - 实存 builtin `visible/index.tsx`（file/knowledge/todo/search/skill_index/plan/terminal_process/interpreter_process）
 * - method_exec（本地 ./MethodExecWindowDetail）
 * - 从 viewer 内联抽出的 feishu_chat / feishu_doc / do / talk
 *
 * supervisor / user / root 窗不注册——它们返回 null / 落 JSON 兜底，不接 window prop、
 * 不在 RENDERABLE_VISIBLE_TYPES（root 窗是虚拟根容器，渲染期落 resolveWindowVisible 兜底，无害）。
 */
import type { ComponentType } from "react";
import type { ContextWindow } from "../../context-snapshot";

import FileWindowDetail from "@ooc/builtins/filesystem/file/visible/index";
import KnowledgeWindowDetail from "@ooc/builtins/knowledge_base/knowledge/visible/index";
import TodoWindowDetail from "@ooc/builtins/agent/todo/visible/index";
import SearchWindowDetail from "@ooc/builtins/filesystem/search/visible/index";
import SkillIndexWindowDetail from "@ooc/builtins/agent/skill_index/visible/index";
import PlanWindowDetail from "@ooc/builtins/agent/plan/visible/index";
import TerminalProcessWindowDetail from "@ooc/builtins/terminal/terminal_process/visible/index";
import InterpreterProcessWindowDetail from "@ooc/builtins/interpreter/interpreter_process/visible/index";
import MethodExecWindowDetail from "../MethodExecWindowDetail";
import FeishuChatWindowDetail from "./FeishuChatWindowDetail";
import FeishuDocWindowDetail from "./FeishuDocWindowDetail";
import DoWindowDetail from "./DoWindowDetail";
import TalkWindowDetail from "./TalkWindowDetail";

/**
 * builtin window 视觉组件 props 契约。`callMethod` 仅 flow scope（有 sessionId）注入——
 * 让组件经 HTTP /call_method 调 visible/server 改 object data（如 todo set_content）；
 * 无注入时组件优雅降级为只读。多数 builtin 只读、忽略 callMethod，类型上统一可选承接。
 */
export type WindowVisibleComp = ComponentType<{
  window: ContextWindow;
  callMethod?: (method: string, args?: object) => Promise<unknown>;
}>;

/**
 * builtin window type → 视觉组件。组件约定 `({ window, callMethod? }) => JSX`。
 *
 * builtin `visible/index` 组件签名是 `{ window: OocObjectInstance<Data, Win> }`（信封 + data + win）；
 * web `ContextWindow` 是同形镜像，但各 class 的 `data` 形态精确到具体 class，与组件期望的具体 `Data`
 * 不互相 assignable，故经 `unknown` 统一收口为 `WindowVisibleComp`。
 */
export const BUILTIN_VISIBLE: Record<string, WindowVisibleComp> = {
  file: FileWindowDetail as unknown as WindowVisibleComp,
  knowledge: KnowledgeWindowDetail as unknown as WindowVisibleComp,
  todo: TodoWindowDetail as unknown as WindowVisibleComp,
  search: SearchWindowDetail as unknown as WindowVisibleComp,
  skill_index: SkillIndexWindowDetail as unknown as WindowVisibleComp,
  plan: PlanWindowDetail as unknown as WindowVisibleComp,
  terminal_process: TerminalProcessWindowDetail as unknown as WindowVisibleComp,
  interpreter_process: InterpreterProcessWindowDetail as unknown as WindowVisibleComp,
  method_exec: MethodExecWindowDetail as unknown as WindowVisibleComp,
  feishu_chat: FeishuChatWindowDetail as unknown as WindowVisibleComp,
  feishu_doc: FeishuDocWindowDetail as unknown as WindowVisibleComp,
  do: DoWindowDetail as unknown as WindowVisibleComp,
  // 会话窗三 class 同形（H2）：talk other-view + thread/reflect_request self-view 共用 TalkWindowDetail。
  talk: TalkWindowDetail as unknown as WindowVisibleComp,
  thread: TalkWindowDetail as unknown as WindowVisibleComp,
  reflect_request: TalkWindowDetail as unknown as WindowVisibleComp,
};
