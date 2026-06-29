/**
 * builtin-visible-registry — builtin class 的 window 视觉组件静态注册表。
 *
 * **2026-06-29 重构 (A1+A2 web build fix)**:
 *
 * ooc-6 时代每个 builtin 自带 `visible/index.tsx`,本注册表直接 import。
 * main 当前 builtin 命名空间已改 (issue O),旧路径全 MISSING。新设计走
 * `visible/index.tsx` 的 `client-source-url` endpoint + 前端 dynamic import
 * (ObjectClientRenderer);本表降级为**纯占位 fallback**,直至各 builtin
 * 真正实装 visible/index.tsx + 接通 client-source-url endpoint。
 *
 * - method_exec / feishu_chat / feishu_doc / do / talk 是本目录自有组件, 保留。
 * - 其余 8 个 builtin window type → 占位组件 (展示 window 数据 JSON, 等真 visible 来)。
 *
 * 线 A 设计 (S 系列文档锚): 经 ObjectClientRenderer + clientSourceUrl 路径动态
 * 加载某 class 的 visible/index.tsx, 完全替代静态注册表;本表仅为对 web 接通时
 * 仍命中的 type→component 兜底,避免空界面。
 */
import type { ComponentType, ReactElement } from "react";
import type { ContextWindow } from "../../context-snapshot";

import MethodExecWindowDetail from "../MethodExecWindowDetail";
import FeishuChatWindowDetail from "./FeishuChatWindowDetail";
import FeishuDocWindowDetail from "./FeishuDocWindowDetail";
import DoWindowDetail from "./DoWindowDetail";
import TalkWindowDetail from "./TalkWindowDetail";

/**
 * 占位组件 — 当某 builtin 还没真实装 visible/index.tsx 时使用。
 */
function PlaceholderWindowDetail({ window: w }: { window: ContextWindow }): ReactElement {
  return (
    <div style={{ padding: 12, color: "var(--muted-foreground, #666)", fontSize: 12 }}>
      <p style={{ marginBottom: 8, opacity: 0.7 }}>
        [builtin visible 待实装] window type: <code>{(w as { type?: string }).type}</code>
      </p>
      <pre style={{ background: "var(--accent, #f5f5f5)", padding: 8, borderRadius: 4, overflow: "auto" }}>
        {JSON.stringify(w, null, 2).slice(0, 800)}
      </pre>
    </div>
  );
}

/** builtin window type → 视觉组件。 */
export const BUILTIN_VISIBLE: Record<string, ComponentType<{ window: ContextWindow }>> = {
  // ⏳ 待 builtin 实装 visible/index.tsx + 接通 client-source-url 后切到 ObjectClientRenderer 路径
  file: PlaceholderWindowDetail,
  knowledge: PlaceholderWindowDetail,
  todo: PlaceholderWindowDetail,
  search: PlaceholderWindowDetail,
  skill_index: PlaceholderWindowDetail,
  plan: PlaceholderWindowDetail,
  program: PlaceholderWindowDetail,
  root: PlaceholderWindowDetail,
  // ✅ 本目录自有组件 — 保留
  method_exec: MethodExecWindowDetail as unknown as ComponentType<{ window: ContextWindow }>,
  feishu_chat: FeishuChatWindowDetail,
  feishu_doc: FeishuDocWindowDetail,
  do: DoWindowDetail,
  talk: TalkWindowDetail,
};
