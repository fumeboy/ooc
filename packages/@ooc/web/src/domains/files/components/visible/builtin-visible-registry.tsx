/**
 * builtin-visible-registry — builtin class 的 window 视觉组件静态注册表。
 *
 * **2026-06-29 P1 升级**: 8 个 Placeholder → 真组件。
 *
 * 上一版(A 系列 web build fix)用 PlaceholderWindowDetail 兜 8 个 builtin window type,
 * 控制面渲染只见 JSON。本次 P1 实装真 UI(read-only 视觉, attrs + 列表 / markdown),
 * 让 web 控制面立刻可用 — visible 设计承诺的兑现第一步。
 *
 * 设计权威: `.ooc-world-meta/.../visible/self.md` ## 核心设计
 * 落地 issue: `.ooc-world-meta/.../docs/issues/2026-06-29-p1-builtin-visible-from-placeholder.md`
 *
 * 路径分工:
 * - **本表(静态)**: builtin 走静态注册 — visible/self.md `resolveWindowVisible.tsx:9` 已明确
 *   "BUILTIN_VISIBLE[window.class]" 是 builtin 的实际渲染路径。
 * - **dynamic 路径**: user-defined object 走 `clientSourceUrl` endpoint + `/@fs` dynamic
 *   import(resolveWindowVisible.tsx 的 kind="dynamic" 分支)。
 *
 * 未来 Phase 2(本 issue 范围外): 实装 `client-source-url` endpoint(当前 main 仓 core 未实装)
 * + builtin 自带 `<ObjectDir>/visible/index.tsx`,完全切到 dynamic 路径并删本表。
 *
 * PlaceholderWindowDetail 保留作为 fallback(若新 builtin 未来加进来还没 visible,可显式
 * 指向 Placeholder 兜底),不再默认用于已知 type。
 */
import type { ComponentType, ReactElement } from "react";
import type { ContextWindow } from "../../context-snapshot";

import MethodExecWindowDetail from "../MethodExecWindowDetail";
import FeishuChatWindowDetail from "./FeishuChatWindowDetail";
import FeishuDocWindowDetail from "./FeishuDocWindowDetail";
import TalkWindowDetail from "./TalkWindowDetail";
// P1 新增 8 个 builtin window detail
import FileWindowDetail from "./FileWindowDetail";
import KnowledgeWindowDetail from "./KnowledgeWindowDetail";
import TodoWindowDetail from "./TodoWindowDetail";
import SearchWindowDetail from "./SearchWindowDetail";
import SkillIndexWindowDetail from "./SkillIndexWindowDetail";
import PlanWindowDetail from "./PlanWindowDetail";
import ProgramWindowDetail from "./ProgramWindowDetail";
import RootWindowDetail from "./RootWindowDetail";

/**
 * 占位组件 — 给"已知该 type 但还没真 visible"的临时兜底。
 *
 * 现在所有已知 builtin type 都有真组件(P1 落地),本函数仅留作:
 *  - 未来新增 builtin 临时 fallback
 *  - 测试 / 调试时手动指向
 */
export function PlaceholderWindowDetail({ window: w }: { window: ContextWindow }): ReactElement {
  return (
    <div style={{ padding: 12, color: "var(--muted-foreground, #666)", fontSize: 12 }}>
      <p style={{ marginBottom: 8, opacity: 0.7 }}>
        [builtin visible 待实装] window class: <code>{(w as { class?: string }).class}</code>
      </p>
      <pre style={{ background: "var(--accent, #f5f5f5)", padding: 8, borderRadius: 4, overflow: "auto" }}>
        {JSON.stringify(w, null, 2).slice(0, 800)}
      </pre>
    </div>
  );
}

/** builtin window type → 视觉组件。 */
export const BUILTIN_VISIBLE: Record<string, ComponentType<{ window: ContextWindow }>> = {
  // ✅ P1 真组件
  file: FileWindowDetail as unknown as ComponentType<{ window: ContextWindow }>,
  knowledge: KnowledgeWindowDetail as unknown as ComponentType<{ window: ContextWindow }>,
  todo: TodoWindowDetail as unknown as ComponentType<{ window: ContextWindow }>,
  search: SearchWindowDetail as unknown as ComponentType<{ window: ContextWindow }>,
  skill_index: SkillIndexWindowDetail as unknown as ComponentType<{ window: ContextWindow }>,
  plan: PlanWindowDetail as unknown as ComponentType<{ window: ContextWindow }>,
  program: ProgramWindowDetail as unknown as ComponentType<{ window: ContextWindow }>,
  root: RootWindowDetail as unknown as ComponentType<{ window: ContextWindow }>,
  // ✅ 既有(A 系列前已存在)
  method_exec: MethodExecWindowDetail as unknown as ComponentType<{ window: ContextWindow }>,
  feishu_chat: FeishuChatWindowDetail,
  feishu_doc: FeishuDocWindowDetail,
  talk: TalkWindowDetail,
  // do_window 已退役 (issue B 合并入 talk), 2026-06-29 删
};
