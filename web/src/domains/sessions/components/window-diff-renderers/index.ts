/**
 * Round 10 F3 — window-diff-renderers 入口（side-effect register）。
 *
 * `import "./window-diff-renderers"` 即触发所有 type renderer 注册。
 * LoopDiffView 在文件顶部一次性 import，之后调用 getWindowDiffRenderer(type)
 * 拿到对应渲染器；未注册 → 调用方 fallback FallbackJsonDiff。
 */

import { registerWindowDiffRenderer } from "./registry";

import { FileWindowDiff } from "./FileWindowDiff";
import { TalkWindowDiff } from "./TalkWindowDiff";
import { DoWindowDiff } from "./DoWindowDiff";
import { PlanWindowDiff } from "./PlanWindowDiff";
import { SearchWindowDiff } from "./SearchWindowDiff";
import { KnowledgeWindowDiff } from "./KnowledgeWindowDiff";
import { ProgramWindowDiff } from "./ProgramWindowDiff";
import { CommandExecDiff } from "./CommandExecDiff";

// type name 与 ContextWindow type 字面量保持一致（见 web/src/domains/files/context-snapshot.ts）。
registerWindowDiffRenderer("file", FileWindowDiff);
registerWindowDiffRenderer("talk", TalkWindowDiff);
registerWindowDiffRenderer("do", DoWindowDiff);
registerWindowDiffRenderer("plan", PlanWindowDiff);
registerWindowDiffRenderer("search", SearchWindowDiff);
registerWindowDiffRenderer("knowledge", KnowledgeWindowDiff);
registerWindowDiffRenderer("program", ProgramWindowDiff);
registerWindowDiffRenderer("command_exec", CommandExecDiff);

export { FallbackJsonDiff } from "./FallbackJsonDiff";
export { DiffRendererErrorBoundary } from "./ErrorBoundary";
export {
  getWindowDiffRenderer,
  registerWindowDiffRenderer,
  listRegisteredDiffRenderers,
  resetWindowDiffRegistry,
  type WindowDiffRenderer,
  type WindowDiffRendererProps,
} from "./registry";
